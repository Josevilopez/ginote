import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  castRematchVote,
  createRoom,
  ensureHost,
  scheduleLobbyCheck,
  startPrivate,
  substituteWithBot,
  swapPrivateSeats,
  triggerNextHand,
  type Room,
} from '../src/room.js';

/**
 * S3-03 — Mesas privadas: sin cuenta atrás, el anfitrión mueve a los
 * jugadores de asiento y empieza cuando quiere; sin ELO.
 */
type Msg = { type: string; [k: string]: unknown };

function mkPrivate(): Room {
  const room = createRoom({ code: 'PRIV', fillWithBots: false });
  room.isPrivate = true;
  return room;
}

/** Sienta a un humano en el primer hueco libre (como el WS handler). */
function join(room: Room, name: string): { seat: number; inbox: Msg[]; ws: unknown } {
  const seat = room.players.findIndex((p) => p.token === null && !p.substitute);
  const inbox: Msg[] = [];
  const ws = { readyState: 1, send: (d: string) => inbox.push(JSON.parse(d)) };
  const p = room.players[seat]!;
  p.token = `tok-${name}`;
  p.name = name;
  p.playerId = `pid-${name}`;
  p.ws = ws as never;
  scheduleLobbyCheck(room);
  return { seat, inbox, ws };
}

const last = (box: Msg[], type: string) => [...box].reverse().find((m) => m.type === type);

describe('S3-03 mesas privadas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sin cuenta atrás: aunque pase el tiempo, no reparte sola', () => {
    const room = mkPrivate();
    const a = join(room, 'Ana');
    expect(room.lobbyEndsAt).toBeNull();
    vi.advanceTimersByTime(120_000);
    expect(room.state).toBeNull();
    expect(last(a.inbox, 'LOBBY_STATUS')).toMatchObject({ isPrivate: true, hostSeat: 0, endsAt: null });
  });

  it('ni con 4 humanos empieza sola', () => {
    const room = mkPrivate();
    for (const n of ['Ana', 'Bea', 'Carlos', 'Dani']) join(room, n);
    expect(room.state).toBeNull();
  });

  it('el anfitrión es el primero; si se va antes de empezar, pasa al siguiente', () => {
    const room = mkPrivate();
    join(room, 'Ana');
    join(room, 'Bea');
    expect(room.hostSeat).toBe(0);
    // Ana se va (como el LEAVE en lobby)
    const p = room.players[0]!;
    p.token = null; p.name = '?'; p.ws = null; delete p.playerId;
    scheduleLobbyCheck(room);
    expect(room.hostSeat).toBe(1);
  });

  it('el anfitrión mueve jugadores de asiento: viajan nombre, token, conexión e identidad', () => {
    const room = mkPrivate();
    const ana = join(room, 'Ana'); // asiento 0
    const bea = join(room, 'Bea'); // asiento 1
    // Ana quiere a Bea de pareja (enfrente, asiento 2)
    expect(swapPrivateSeats(room, 0, 1, 2)).toBeNull();
    expect(room.players[2]!.name).toBe('Bea');
    expect(room.players[2]!.token).toBe('tok-Bea');
    expect(room.players[2]!.playerId).toBe('pid-Bea');
    expect(room.players[2]!.ws).toBe(bea.ws);
    expect(room.players[1]!.token).toBeNull();
    expect(room.players[1]!.playerId).toBeUndefined();
    // Bea recibe su nuevo asiento
    expect(last(bea.inbox, 'WELCOME')).toMatchObject({ you: 2, token: 'tok-Bea' });
    expect(last(ana.inbox, 'LOBBY_STATUS')).toMatchObject({ seatNames: ['Ana', '?', 'Bea', '?'] });
  });

  it('el anfitrión puede moverse a sí mismo y sigue siendo anfitrión', () => {
    const room = mkPrivate();
    join(room, 'Ana');
    join(room, 'Bea');
    expect(swapPrivateSeats(room, 0, 0, 3)).toBeNull();
    expect(room.hostSeat).toBe(3);
    expect(room.players[3]!.name).toBe('Ana');
  });

  it('solo el anfitrión puede mover y empezar', () => {
    const room = mkPrivate();
    join(room, 'Ana');
    join(room, 'Bea');
    expect(swapPrivateSeats(room, 1, 0, 2)).toMatch(/anfitrión/);
    expect(startPrivate(room, 1, 2)).toMatch(/anfitrión/);
    expect(room.state).toBeNull();
  });

  it('empezar completa los huecos con bots del nivel elegido y reparte', () => {
    const room = mkPrivate();
    const ana = join(room, 'Ana');
    join(room, 'Bea');
    expect(startPrivate(room, 0, 1)).toBeNull();
    expect(room.state).not.toBeNull();
    expect(room.botLevel).toBe(1);
    expect(room.players[2]!.token).toBeNull();
    expect(room.players[2]!.name).not.toBe('?'); // bot con nombre aragonés
    expect(last(ana.inbox, 'VIEW')).toBeDefined();
    // ya empezada: no se puede mover ni volver a empezar
    expect(swapPrivateSeats(room, 0, 0, 2)).toMatch(/empezado/);
    expect(startPrivate(room, 0, 2)).toMatch(/empezado/);
  });

  it('abandonar una mesa privada NO penaliza el ELO', () => {
    const room = mkPrivate();
    join(room, 'Ana');
    join(room, 'Bea');
    startPrivate(room, 0, 2);
    substituteWithBot(room, 1, 'leave');
    expect(room.players[1]!.substitute).toBe(true);
    // (la penalización solo llamaría a Cosmos; aquí comprobamos que no se intenta)
    expect(vi.mocked(console.log).mock.calls.some((c) => String(c[0]).includes('penaliza=true'))).toBe(false);
  });

  it('S3-07: match a 2 cotos — ganar un coto sigue sin votación; el segundo abre la revancha', () => {
    const room = mkPrivate();
    const ana = join(room, 'Ana');
    join(room, 'Bea');
    expect(startPrivate(room, 0, 2, { partidasPorCoto: 3, cotosParaGanar: 2 })).toBeNull();
    const win = (w: 0 | 1) => {
      const st = room.state!;
      st.phase = 'finished'; st.matchEnded = true; st.matchWinner = w; st.turn = null;
      triggerNextHand(room);
    };
    for (let i = 0; i < 3; i++) win(0); // primer coto para el equipo 0
    expect(room.cotoWins).toEqual({ 0: 1, 1: 0 });
    expect(room.matchWins).toEqual({ 0: 0, 1: 0 }); // coto nuevo
    expect(room.postgame).toBeNull();
    expect(room.state!.phase).not.toBe('finished');
    for (let i = 0; i < 3; i++) win(1); // segundo coto para el equipo 1
    expect(room.cotoWins).toEqual({ 0: 1, 1: 1 });
    expect(room.postgame).toBeNull();
    win(0); win(0); win(1); win(0); // tercer coto 3-1 para el equipo 0
    expect(room.cotoWins).toEqual({ 0: 2, 1: 1 });
    expect(room.matchWins).toEqual({ 0: 3, 1: 1 });
    expect(room.postgame).not.toBeNull();
    expect(last(ana.inbox, 'REMATCH_STATUS')).toMatchObject({ cotoWins: { 0: 2, 1: 1 } });
    // revancha: match nuevo desde cero
    castRematchVote(room, 0, true);
    castRematchVote(room, 1, true);
    expect(room.cotoWins).toEqual({ 0: 0, 1: 0 });
    expect(room.matchWins).toEqual({ 0: 0, 1: 0 });
  });

  it('S3-07: formato fuera de límites → error', () => {
    const room = mkPrivate();
    join(room, 'Ana');
    expect(startPrivate(room, 0, 2, { partidasPorCoto: 9, cotosParaGanar: 2 })).toMatch(/Formato/);
    expect(room.state).toBeNull();
  });

  it('una sala pública sigue con su cuenta atrás', () => {
    const room = createRoom({ code: 'PUBL', fillWithBots: false });
    const p = room.players[0]!;
    p.token = 't'; p.ws = { readyState: 1, send: () => undefined } as never;
    scheduleLobbyCheck(room);
    expect(room.lobbyEndsAt).not.toBeNull();
    ensureHost(room);
  });
});
