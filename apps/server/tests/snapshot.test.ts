import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUINOTE_ARAGONES, legalActions, type Seat } from '@guinote/engine';
import {
  applyActionWithResolveEvent,
  castRematchVote,
  createRoom,
  RECONNECT_WINDOW_MS,
  RESUME_GRACE_MS,
  resumeRestoredRoom,
  triggerNextHand,
  type Room,
} from '../src/room.js';
import { setSnapshotSink } from '../src/persistHooks.js';
import { isRoomSnapshot, roomFromSnapshot, serializeRoom, type RoomSnapshot } from '../src/snapshot.js';

/**
 * S2-14 — Persistencia de salas: snapshot al repartir y al final de cada
 * mano (decisión 2026-10-18), rehidratación tras reinicio.
 */
const saved: Array<{ code: string; snap: RoomSnapshot }> = [];
const removed: string[] = [];

function mkRoom(humans: number[] = [0, 1]): Room {
  const room = createRoom({ code: 'SNAP', fillWithBots: true });
  for (const s of humans) {
    room.players[s]!.token = `tok${s}`;
    room.players[s]!.playerId = `pid${s}`;
    room.players[s]!.name = `H${s}`;
    room.players[s]!.ws = { readyState: 1, send: () => undefined } as never;
  }
  return room;
}

/** Juega acciones legales (la primera de cada turno) hasta acabar la mano. */
function playHandToEnd(room: Room): void {
  let guard = 200;
  while (room.state!.phase !== 'finished' && guard-- > 0) {
    const seat = room.state!.turn as Seat;
    const action = legalActions(room.state!, seat)[0]!;
    expect(applyActionWithResolveEvent(room, seat, action)).toBe(true);
  }
  expect(room.state!.phase).toBe('finished');
}

/** Vuelta por JSON, como en Cosmos. */
const roundTrip = (room: Room) => roomFromSnapshot(JSON.parse(JSON.stringify(serializeRoom(room))) as RoomSnapshot);

describe('S2-14 snapshots', () => {
  beforeEach(() => {
    saved.length = 0;
    removed.length = 0;
    setSnapshotSink({
      save: async (room) => {
        const snap = serializeRoom(room);
        if (snap) saved.push({ code: room.code, snap: JSON.parse(JSON.stringify(snap)) });
      },
      remove: async (code) => { removed.push(code); },
    });
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    setSnapshotSink(null);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('una sala en lobby (sin repartir) no genera snapshot', () => {
    const room = createRoom({ code: 'LOBB', fillWithBots: false });
    expect(serializeRoom(room)).toBeNull();
  });

  it('ida y vuelta por JSON conserva partida, asientos y match', () => {
    const room = mkRoom();
    room.matchWins = { 0: 2, 1: 1 };
    room.abandonedPlayerIds.add('pidX');
    room.players[3]!.substitute = true;
    const snap = serializeRoom(room)!;
    expect(isRoomSnapshot(JSON.parse(JSON.stringify(snap)))).toBe(true);
    const back = roundTrip(room);
    expect(back.state).toEqual({ ...room.state, rules: GUINOTE_ARAGONES });
    expect(back.state!.rules).toBe(GUINOTE_ARAGONES);
    expect(back.players.map((p) => [p.token, p.playerId, p.ws])).toEqual([
      ['tok0', 'pid0', null], ['tok1', 'pid1', null], [null, undefined, null], [null, undefined, null],
    ]);
    expect(back.players[3]!.substitute).toBe(true);
    expect(back.matchWins).toEqual({ 0: 2, 1: 1 });
    expect(back.abandonedPlayerIds.has('pidX')).toBe(true);
  });

  it('los snapshots antiguos ({ code }) no son válidos', () => {
    expect(isRoomSnapshot({ code: 'ABCD' })).toBe(false);
  });

  it('guarda al final de la mano (una vez) y la partida rehidratada sigue jugándose', () => {
    const room = mkRoom();
    // A mitad de mano: guardamos (como haría un SIGTERM), rehidratamos y
    // terminamos la mano en la copia sin acciones ilegales.
    for (let i = 0; i < 9; i++) {
      const seat = room.state!.turn as Seat;
      applyActionWithResolveEvent(room, seat, legalActions(room.state!, seat)[0]!);
    }
    const copy = roundTrip(room);
    expect(saved).toHaveLength(0); // a mitad de mano no se guarda
    playHandToEnd(copy);
    playHandToEnd(room);
    expect(saved.filter((s) => s.code === 'SNAP')).toHaveLength(2); // fin de mano en ambas
    expect(saved[0]!.snap.state.phase).toBe('finished');
  });

  it('guarda al abrir la votación y al repartir la revancha; borra al cerrar el match', () => {
    const room = mkRoom();
    const st = room.state!;
    st.phase = 'finished'; st.matchEnded = true; st.matchWinner = 0; st.turn = null;
    triggerNextHand(room);
    expect(saved.at(-1)!.snap.postgameOpen).toBe(true);
    expect(saved.at(-1)!.snap.matchWins).toEqual({ 0: 1, 1: 0 });
    castRematchVote(room, 0, true);
    castRematchVote(room, 1, true);
    expect(saved.at(-1)!.snap.postgameOpen).toBe(false);
    expect(saved.at(-1)!.snap.state.phase).not.toBe('finished'); // reparto de la nueva partida
    const s2 = room.state!;
    s2.phase = 'finished'; s2.matchEnded = true; s2.matchWinner = 1; s2.turn = null;
    triggerNextHand(room);
    castRematchVote(room, 0, false);
    expect(room.matchFinished).toBe(true);
    expect(removed).toEqual(['SNAP']);
  });

  describe('reanudar tras reinicio', () => {
    it('los humanos empiezan desconectados con su ventana; si no vuelven, bot', () => {
      const room = roundTrip(mkRoom());
      resumeRestoredRoom(room, { postgameOpen: false });
      expect(room.players[0]!.reconnectDeadline).toBeGreaterThan(Date.now());
      vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
      expect(room.players[0]!.substitute).toBe(true);
      expect(room.players[1]!.substitute).toBe(true);
    });

    it('mano terminada con fin de partida → tras el margen, cuenta la partida y abre la votación', () => {
      const orig = mkRoom();
      const st = orig.state!;
      st.phase = 'finished'; st.matchEnded = true; st.matchWinner = 1; st.turn = null;
      const room = roundTrip(orig);
      resumeRestoredRoom(room, { postgameOpen: false });
      expect(room.postgame).toBeNull();
      vi.advanceTimersByTime(RESUME_GRACE_MS);
      expect(room.matchWins).toEqual({ 0: 0, 1: 1 });
      expect(room.postgame).not.toBeNull();
    });

    it('con votación abierta → la reabre SIN volver a contar la partida', () => {
      const orig = mkRoom();
      const st = orig.state!;
      st.phase = 'finished'; st.matchEnded = true; st.matchWinner = 0; st.turn = null;
      triggerNextHand(orig); // matchWins 1-0, postgame abierto
      const snap = saved.at(-1)!.snap;
      const room = roomFromSnapshot(snap);
      resumeRestoredRoom(room, { postgameOpen: snap.postgameOpen });
      vi.advanceTimersByTime(RESUME_GRACE_MS);
      expect(room.postgame).not.toBeNull();
      expect(room.matchWins).toEqual({ 0: 1, 1: 0 });
    });
  });
});
