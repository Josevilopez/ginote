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
 * S2-13 — Revancha: primero a 3 partidas, postgame de 20 s con voto.
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

const last = (box: Inbox[number], type: string) => [...box].reverse().find((m) => m.type === type);

describe('S2-13 revancha', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fin de partida → +1 matchWins y abre postgame (bots votan yes)', () => {
    const { room, inbox } = mkRoom([0, 1]);
    endPartida(room, 0);
    triggerNextHand(room);
    expect(room.matchWins).toEqual({ 0: 1, 1: 0 });
    expect(room.postgame).not.toBeNull();
    const st = last(inbox[0]!, 'REMATCH_STATUS') as { votes: Record<string, string> };
    expect(st.votes).toEqual({ '0': 'pending', '1': 'pending', '2': 'yes', '3': 'yes' });
  });

  it('triggerNextHand repetido durante el postgame NO cuenta la partida dos veces', () => {
    const { room } = mkRoom([0]);
    endPartida(room, 1);
    triggerNextHand(room);
    triggerNextHand(room);
    triggerNextHand(room);
    expect(room.matchWins).toEqual({ 0: 0, 1: 1 });
  });

  it('unanimidad de humanos → nueva partida desde cero', () => {
    const { room } = mkRoom([0, 1]);
    endPartida(room, 0);
    triggerNextHand(room);
    castRematchVote(room, 0, true);
    expect(room.postgame).not.toBeNull(); // falta el seat 1
    castRematchVote(room, 1, true);
    expect(room.postgame).toBeNull();
    expect(room.state!.phase).not.toBe('finished');
    expect(room.state!.matchEnded).toBe(false);
    expect(room.state!.vuelta).toBe(1);
    expect(room.state!.cumulativeTeamPts).toEqual({ 0: 0, 1: 0 });
    expect(room.state!.score.buenas).toEqual({ 0: 0, 1: 0 });
    expect(room.matchWins).toEqual({ 0: 1, 1: 0 });
  });

  it('el primero en llegar a 3 gana el match y la mesa se cierra', () => {
    const { room, inbox } = mkRoom([0]);
    for (let i = 0; i < 2; i++) {
      endPartida(room, 0);
      triggerNextHand(room);
      castRematchVote(room, 0, true);
    }
    endPartida(room, 0);
    triggerNextHand(room);
    expect(room.matchFinished).toBe(true);
    expect(room.matchChampion).toBe(0);
    expect(room.postgame).toBeNull();
    expect(last(inbox[0]!, 'MATCH_ENDED')).toMatchObject({ winner: 0, reason: 'won', matchWins: { 0: 3, 1: 0 } });
    // Cerrada: ni reparte ni acepta votos.
    triggerNextHand(room);
    expect(room.state!.phase).toBe('finished');
    expect(castRematchVote(room, 0, true)).toBe(false);
  });

  it('un voto "no" cierra el match con quien lleve más partidas', () => {
    const { room, inbox } = mkRoom([0, 1]);
    endPartida(room, 1);
    triggerNextHand(room);
    castRematchVote(room, 0, false);
    expect(room.matchFinished).toBe(true);
    expect(last(inbox[1]!, 'MATCH_ENDED')).toMatchObject({ winner: 1, reason: 'declined' });
  });

  it('abandonar (LEAVE) durante el postgame cierra el match', () => {
    const { room } = mkRoom([0, 1]);
    endPartida(room, 0);
    triggerNextHand(room);
    castRematchVote(room, 0, true);
    abandonDuringPostgame(room, 1);
    expect(room.matchFinished).toBe(true);
    expect(room.matchEndReason).toBe('abandoned');
    expect(room.matchChampion).toBe(0);
  });

  it('timeout sin unanimidad con empate 1-1 → MATCH_ENDED con winner null', () => {
    const { room, inbox } = mkRoom([0]);
    endPartida(room, 0);
    triggerNextHand(room);
    castRematchVote(room, 0, true);
    endPartida(room, 1);
    triggerNextHand(room);
    expect(room.matchWins).toEqual({ 0: 1, 1: 1 });
    vi.advanceTimersByTime(REMATCH_VOTE_TIMEOUT_MS - 1);
    expect(room.matchFinished).toBe(false);
    vi.advanceTimersByTime(1);
    expect(room.matchFinished).toBe(true);
    expect(room.matchChampion).toBeNull();
    expect(last(inbox[0]!, 'MATCH_ENDED')).toMatchObject({ winner: null, reason: 'timeout' });
  });

  it('quien (re)conecta recibe el estado del postgame o del cierre', () => {
    const { room } = mkRoom([0]);
    endPartida(room, 0);
    triggerNextHand(room);
    const got: Array<{ type: string }> = [];
    const ws = { readyState: 1, send: (d: string) => got.push(JSON.parse(d)) };
    sendPostgameStateTo(room, ws);
    expect(got[0]?.type).toBe('REMATCH_STATUS');
    castRematchVote(room, 0, false);
    sendPostgameStateTo(room, ws);
    expect(got[1]).toMatchObject({ type: 'MATCH_ENDED', reason: 'declined' });
  });
});
