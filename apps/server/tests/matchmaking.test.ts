import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOT_FILL_AFTER_MS,
  _clearQueue,
  enqueue,
  formTables,
  listQueue,
  playersSearching,
  ratingWindow,
  type QueueEntry,
} from '../src/matchmaking.js';
import { startQueuedTable, QUEUE_START_GRACE_MS } from '../src/queueRoom.js';
import { scheduleLobbyCheck } from '../src/room.js';
import { setRoomStore } from '../src/rooms.js';
import { MemoryRoomStore } from '../src/persistence/memory.js';

/** S3-05 — cola de "Jugar online" por nivel, con sueltos y parejas. */
const T0 = 1_000_000;
let n = 0;

function single(name: string, rating = 1000, at = T0): QueueEntry {
  return { id: `s${++n}`, members: [{ playerId: `pid-${name}`, name, rating }], enqueuedAt: at, notify: vi.fn() };
}
function pair(a: string, b: string, rating = 1000, at = T0): QueueEntry {
  return {
    id: `p${++n}`,
    members: [
      { playerId: `pid-${a}`, name: a, rating },
      { playerId: `pid-${b}`, name: b, rating },
    ],
    enqueuedAt: at,
    partyCode: `P${n}`,
    notify: vi.fn(),
  };
}
/** Asiento de cada jugador por nombre. */
function seatsByName(t: ReturnType<typeof formTables>[number]): Record<string, number> {
  const out: Record<string, number> = {};
  t.entries.forEach((e, i) => e.members.forEach((m, k) => (out[m.name] = t.seats[i]![k]!)));
  return out;
}

beforeEach(() => {
  _clearQueue();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ventana de nivel', () => {
  it('±100 al entrar, +50 cada 5 s, tope ±400', () => {
    const e = single('a');
    expect(ratingWindow(e, T0)).toBe(100);
    expect(ratingWindow(e, T0 + 5_000)).toBe(150);
    expect(ratingWindow(e, T0 + 15_000)).toBe(250);
    expect(ratingWindow(e, T0 + 120_000)).toBe(400);
  });
});

describe('formar mesas', () => {
  it('4 sueltos de nivel parecido: el mejor con el peor', () => {
    enqueue(single('A', 1200));
    enqueue(single('B', 1150));
    enqueue(single('C', 1120));
    enqueue(single('D', 1110));
    const [t, ...rest] = formTables(T0);
    expect(rest).toHaveLength(0);
    expect(t!.bots).toBe(0);
    const s = seatsByName(t!);
    expect([s.A, s.D].sort()).toEqual([0, 2]);
    expect([s.B, s.C].sort()).toEqual([1, 3]);
    expect(listQueue()).toHaveLength(0);
  });

  it('no junta niveles muy distintos al principio; sí cuando la ventana crece', () => {
    enqueue(single('A', 1000));
    enqueue(single('B', 1000));
    enqueue(single('C', 1000));
    enqueue(single('Pro', 1250));
    expect(formTables(T0)).toEqual([]);
    // A los 15 s la ventana es ±250: ya cabe.
    expect(formTables(T0 + 15_000)).toHaveLength(1);
  });

  it('pareja contra pareja: cada una un equipo', () => {
    enqueue(pair('Jose', 'Pilar'));
    enqueue(pair('Ana', 'Bea'));
    const s = seatsByName(formTables(T0)[0]!);
    expect([s.Jose, s.Pilar].sort()).toEqual([0, 2]);
    expect([s.Ana, s.Bea].sort()).toEqual([1, 3]);
  });

  it('pareja contra dos sueltos', () => {
    enqueue(single('Ana'));
    enqueue(pair('Jose', 'Pilar'));
    enqueue(single('Bea'));
    const [t] = formTables(T0);
    const s = seatsByName(t!);
    expect([s.Jose, s.Pilar].sort()).toEqual([0, 2]);
    expect([s.Ana, s.Bea].sort()).toEqual([1, 3]);
  });

  it('con 5 sueltos sale una mesa y uno sigue esperando', () => {
    for (const x of ['A', 'B', 'C', 'D', 'E']) enqueue(single(x, 1000, T0 + x.charCodeAt(0)));
    expect(formTables(T0 + 100)).toHaveLength(1);
    expect(listQueue().map((e) => e.members[0]!.name)).toEqual(['E']);
    expect(playersSearching()).toBe(1);
  });

  it(`solo: espera; a los ${BOT_FILL_AFTER_MS / 1000} s, mesa con 3 bots`, () => {
    enqueue(single('Solo', 900));
    expect(formTables(T0 + BOT_FILL_AFTER_MS - 1)).toEqual([]);
    const [t] = formTables(T0 + BOT_FILL_AFTER_MS);
    expect(t).toMatchObject({ bots: 3, botLevel: 1 });
    expect(seatsByName(t!)).toEqual({ Solo: 0 });
  });

  it('dos sueltos sin más gente: uno en cada equipo, con bots (cuenta para el ELO)', () => {
    enqueue(single('A', 1100));
    enqueue(single('B', 1000));
    const [t] = formTables(T0 + BOT_FILL_AFTER_MS);
    expect(t).toMatchObject({ bots: 2, botLevel: 2 });
    expect(seatsByName(t!)).toEqual({ A: 0, B: 1 });
  });

  it('a la hora de meter bots, antes cualquier humano aunque su nivel sea muy distinto', () => {
    enqueue(single('Novato', 1000));
    enqueue(single('Crack', 1400, T0 + 5_000));
    // Antes de los 20 s no se juntan (fuera de la ventana)…
    expect(formTables(T0 + 10_000)).toEqual([]);
    // …pero a los 20 s juegan juntos en vez de cada uno con 3 bots.
    const tables = formTables(T0 + BOT_FILL_AFTER_MS);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.bots).toBe(2);
    expect(seatsByName(tables[0]!)).toEqual({ Crack: 0, Novato: 1 });
  });

  it('con 4 humanos de niveles dispares, a los 20 s mesa completa sin bots', () => {
    enqueue(single('A', 800));
    enqueue(single('B', 1000));
    enqueue(single('C', 1250));
    enqueue(pair('X', 'Y', 1500));
    expect(formTables(T0 + 1_000)).toEqual([]);
    const [t, rest] = formTables(T0 + BOT_FILL_AFTER_MS);
    // A (800) + B + la pareja: 4 humanos, sin bots.
    expect(t!.bots).toBe(0);
    expect(t!.entries.map((e) => e.members[0]!.name)).toEqual(['A', 'B', 'X']);
    // C también llevaba 20 s: en el mismo tick, su mesa con bots.
    expect(rest).toMatchObject({ bots: 3 });
    expect(listQueue()).toHaveLength(0);
  });

  it('tres sueltos: el mejor con un bot contra los otros dos', () => {
    enqueue(single('A', 1100));
    enqueue(single('B', 1050));
    enqueue(single('C', 1000));
    const [t] = formTables(T0 + BOT_FILL_AFTER_MS);
    expect(t!.bots).toBe(1);
    expect(seatsByName(t!)).toEqual({ A: 0, B: 1, C: 3 });
  });

  it('pareja sola a los 20 s: contra dos bots', () => {
    enqueue(pair('Jose', 'Pilar'));
    const [t] = formTables(T0 + BOT_FILL_AFTER_MS);
    expect(t!.bots).toBe(2);
    expect(seatsByName(t!)).toEqual({ Jose: 0, Pilar: 2 });
  });
});

describe('de la cola a la sala', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setRoomStore(new MemoryRoomStore());
  });

  it('reserva asientos, avisa con los tokens y reparte al conectar todos', () => {
    const a = single('Ana', 1000);
    const b = single('Bea', 1000);
    enqueue(a);
    enqueue(b);
    const [t] = formTables(T0 + BOT_FILL_AFTER_MS);
    const room = startQueuedTable(t!, Date.now());
    expect(room.botLevel).toBe(2);
    expect(room.state).toBeNull();
    const na = (a.notify as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(na).toMatchObject({ roomCode: room.code, seats: [0] });
    expect(room.players[0]).toMatchObject({ name: 'Ana', token: na.tokens[0], playerId: 'pid-Ana' });
    // Ana conecta: aún falta Bea → no se reparte.
    room.players[0]!.ws = { readyState: 1, send: () => undefined } as never;
    scheduleLobbyCheck(room);
    expect(room.state).toBeNull();
    // Bea conecta → se reparte ya, con bots en los huecos.
    room.players[1]!.ws = { readyState: 1, send: () => undefined } as never;
    scheduleLobbyCheck(room);
    expect(room.state).not.toBeNull();
    expect(room.players[2]!.token).toBeNull();
  });

  it(`si alguien no conecta, se reparte igual a los ${QUEUE_START_GRACE_MS / 1000} s`, () => {
    enqueue(single('Ana'));
    const [t] = formTables(T0 + BOT_FILL_AFTER_MS);
    const room = startQueuedTable(t!, Date.now());
    vi.advanceTimersByTime(QUEUE_START_GRACE_MS - 1);
    expect(room.state).toBeNull();
    vi.advanceTimersByTime(1);
    expect(room.state).not.toBeNull();
  });
});
