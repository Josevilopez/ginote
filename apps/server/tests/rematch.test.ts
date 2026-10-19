import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abandonDuringPostgame,
  castRematchVote,
  createRoom,
  REMATCH_VOTE_TIMEOUT_MS,
  sendPostgameStateTo,
  triggerNextHand,
  type Room,
} from '../src/room.js';

/**
 * S2-13 + S3-06 — Partida rápida = 1 coto (primero a 3 partidas).
 * Las partidas del coto se encadenan solas; la revancha (coto nuevo desde
 * 0-0) se vota AL ACABAR EL COTO, con 20 s de plazo.
 * Los humanos se simulan con un WS falso que acumula los mensajes.
 */
type Inbox = Record<number, Array<{ type: string; [k: string]: unknown }>>;

function mkRoom(humans: number[]): { room: Room; inbox: Inbox } {
  const room = createRoom({ code: 'TEST', fillWithBots: true });
  const inbox: Inbox = {};
  for (const s of humans) {
    inbox[s] = [];
    const p = room.players[s]!;
    p.token = `tok${s}`;
    p.ws = { readyState: 1, send: (d: string) => inbox[s]!.push(JSON.parse(d)) } as never;
  }
  return { room, inbox };
}

/** Fuerza el fin de una partida (el motor la daría por cerrada al pasar de 100). */
function endPartida(room: Room, winner: 0 | 1): void {
  const st = room.state!;
  st.phase = 'finished';
  st.matchEnded = true;
  st.matchWinner = winner;
  st.turn = null;
}

/** Termina una partida y deja que el server pase a lo siguiente. */
function playPartida(room: Room, winner: 0 | 1): void {
  endPartida(room, winner);
  triggerNextHand(room);
}

/** Juega partidas hasta que `winner` gana el coto (las del rival, antes). */
function playCoto(room: Room, winner: 0 | 1, rivalWins = 0): void {
  for (let i = 0; i < rivalWins; i++) playPartida(room, (1 - winner) as 0 | 1);
  for (let i = 0; i < 3; i++) playPartida(room, winner);
}

const last = (box: Inbox[number], type: string) => [...box].reverse().find((m) => m.type === type);

describe('S3-06 partida rápida = 1 coto, revancha al final', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fin de partida sin ganar el coto → +1 y siguiente partida directamente, sin votación', () => {
    const { room, inbox } = mkRoom([0, 1]);
    playPartida(room, 0);
    expect(room.matchWins).toEqual({ 0: 1, 1: 0 });
    expect(room.postgame).toBeNull();
    expect(last(inbox[0]!, 'REMATCH_STATUS')).toBeUndefined();
    // Partida nueva repartida desde cero.
    expect(room.state!.phase).not.toBe('finished');
    expect(room.state!.matchEnded).toBe(false);
    expect(room.state!.vuelta).toBe(1);
    expect(room.state!.cumulativeTeamPts).toEqual({ 0: 0, 1: 0 });
  });

  it('las partidas se encadenan: 2-1 sin ninguna votación', () => {
    const { room, inbox } = mkRoom([0, 1]);
    playPartida(room, 0);
    playPartida(room, 1);
    playPartida(room, 0);
    expect(room.matchWins).toEqual({ 0: 2, 1: 1 });
    expect(room.postgame).toBeNull();
    expect(last(inbox[1]!, 'REMATCH_STATUS')).toBeUndefined();
  });

  it('al llegar a 3 se acaba el coto y se abre la votación (bots votan yes)', () => {
    const { room, inbox } = mkRoom([0, 1]);
    playCoto(room, 1, 2); // 2-3
    expect(room.matchWins).toEqual({ 0: 2, 1: 3 });
    expect(room.postgame).not.toBeNull();
    expect(room.matchFinished).toBe(false);
    const st = last(inbox[0]!, 'REMATCH_STATUS') as { votes: Record<string, string>; matchWins: unknown };
    expect(st.votes).toEqual({ '0': 'pending', '1': 'pending', '2': 'yes', '3': 'yes' });
    expect(st.matchWins).toEqual({ 0: 2, 1: 3 });
  });

  it('triggerNextHand repetido durante la votación NO cuenta la partida dos veces', () => {
    const { room } = mkRoom([0]);
    playCoto(room, 1);
    triggerNextHand(room);
    triggerNextHand(room);
    expect(room.matchWins).toEqual({ 0: 0, 1: 3 });
  });

  it('revancha aceptada por todos los humanos → coto nuevo desde 0-0', () => {
    const { room } = mkRoom([0, 1]);
    playCoto(room, 0, 1);
    castRematchVote(room, 0, true);
    expect(room.postgame).not.toBeNull(); // falta el seat 1
    castRematchVote(room, 1, true);
    expect(room.postgame).toBeNull();
    expect(room.matchWins).toEqual({ 0: 0, 1: 0 });
    expect(room.matchFinished).toBe(false);
    expect(room.state!.phase).not.toBe('finished');
    expect(room.state!.score.buenas).toEqual({ 0: 0, 1: 0 });
    // y el coto nuevo funciona igual
    playPartida(room, 1);
    expect(room.matchWins).toEqual({ 0: 0, 1: 1 });
    expect(room.postgame).toBeNull();
  });

  it('un voto "no" cierra la mesa con el ganador del coto', () => {
    const { room, inbox } = mkRoom([0, 1]);
    playCoto(room, 1);
    castRematchVote(room, 0, false);
    expect(room.matchFinished).toBe(true);
    expect(room.matchChampion).toBe(1);
    expect(last(inbox[1]!, 'MATCH_ENDED')).toMatchObject({ winner: 1, reason: 'declined', matchWins: { 0: 0, 1: 3 } });
    // Cerrada: ni reparte ni acepta votos.
    triggerNextHand(room);
    expect(room.state!.phase).toBe('finished');
    expect(castRematchVote(room, 0, true)).toBe(false);
  });

  it('abandonar (LEAVE) durante la votación cierra la mesa', () => {
    const { room } = mkRoom([0, 1]);
    playCoto(room, 0);
    castRematchVote(room, 0, true);
    abandonDuringPostgame(room, 1);
    expect(room.matchFinished).toBe(true);
    expect(room.matchEndReason).toBe('abandoned');
    expect(room.matchChampion).toBe(0);
  });

  it('timeout sin unanimidad → se cierra con el ganador del coto', () => {
    const { room, inbox } = mkRoom([0]);
    playCoto(room, 0, 2);
    vi.advanceTimersByTime(REMATCH_VOTE_TIMEOUT_MS - 1);
    expect(room.matchFinished).toBe(false);
    vi.advanceTimersByTime(1);
    expect(room.matchFinished).toBe(true);
    expect(last(inbox[0]!, 'MATCH_ENDED')).toMatchObject({ winner: 0, reason: 'timeout' });
  });

  it('quien (re)conecta recibe el estado de la votación o del cierre', () => {
    const { room } = mkRoom([0]);
    playCoto(room, 0);
    const got: Array<{ type: string }> = [];
    const ws = { readyState: 1, send: (d: string) => got.push(JSON.parse(d)) };
    sendPostgameStateTo(room, ws);
    expect(got[0]?.type).toBe('REMATCH_STATUS');
    castRematchVote(room, 0, false);
    sendPostgameStateTo(room, ws);
    expect(got[1]).toMatchObject({ type: 'MATCH_ENDED', reason: 'declined' });
  });
});
