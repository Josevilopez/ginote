import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { encodeSession, initSessionSecret, newSession, SESSION_COOKIE } from '../src/auth/session.js';
import { MemoryPlayerRepo, MemoryUserRepo, freshPlayer, type User } from '../src/auth/accounts.js';
import { sessionOf } from '../src/auth/routes.js';
import { createRoom, onMatchEnd, reserveSeat, scheduleLobbyCheck, triggerNextHand, type MatchEnd } from '../src/room.js';
import {
  MemoryTorneoRepo,
  adminAction,
  buildBracket,
  confirmEntry,
  createTorneo,
  goToTable,
  recordTableResult,
  registerTorneoRoutes,
  resolveDeadlines,
  seedOrder,
  signup,
  sweepTorneos,
  withdraw,
  type TableOps,
  type Torneo,
  type TorneoDeps,
} from '../src/torneos.js';

const DAY = 86_400_000;
const T0 = new Date('2026-11-02T10:00:00Z');

beforeEach(() => {
  initSessionSecret({ SESSION_SECRET: 't'.repeat(40) } as NodeJS.ProcessEnv);
});

/** n usuarios g_0..g_{n-1}; g_0 es admin. Todos amigos entre sí. Nivel = 1000 + 10·i. */
async function world(n: number, tables?: TableOps) {
  const users = new MemoryUserRepo();
  const players = new MemoryPlayerRepo();
  const torneos = new MemoryTorneoRepo();
  const ids = Array.from({ length: n }, (_, i) => `g_${i}`);
  for (let i = 0; i < n; i++) {
    const now = T0.toISOString();
    const u: User & { friends: string[] } = {
      id: ids[i]!,
      userId: ids[i]!,
      provider: 'google',
      sub: String(i),
      email: i === 0 ? 'Admin@X.es' : `u${i}@x.es`,
      primaryPlayerId: `p_${i}`,
      linkedPlayerIds: [`p_${i}`],
      createdAt: now,
      lastLoginAt: now,
      friends: ids.filter((x) => x !== ids[i]),
    };
    await users.put(u);
    await players.put({ ...freshPlayer(`p_${i}`), userId: ids[i]!, publicName: `J${i}`, tag: String(1000 + i), rating: 1000 + 10 * i });
  }
  const pushes: { to: string; body: string }[] = [];
  const d: TorneoDeps = { users, players, torneos, adminEmails: ['admin@x.es'], notify: (to, m) => pushes.push({ to, body: m.body }) };
  if (tables) d.tables = tables;
  return { d, pushes };
}

const baseBody = (until: Date) => ({ name: 'Torneo de Navidad', size: 8, partidas: 3, roundDays: 2, signupUntil: until.toISOString() });

/** Crea el torneo y apunta `pairs` parejas confirmadas: (g_1,g_2), (g_3,g_4)… */
async function withPairs(pairs: number, tables?: TableOps) {
  const w = await world(pairs * 2 + 1, tables);
  const c = await createTorneo(w.d, 'g_0', baseBody(new Date(T0.getTime() + DAY)), T0);
  const t = c.ok ? c.value : null!;
  for (let k = 0; k < pairs; k++) {
    const a = `g_${2 * k + 1}`;
    const b = `g_${2 * k + 2}`;
    expect((await signup(w.d, a, t.id, b, T0)).ok).toBe(true);
    expect((await confirmEntry(w.d, b, t.id, T0)).ok).toBe(true);
  }
  return { ...w, id: t.id };
}

describe('cuadro', () => {
  it('orden de cabezas de serie', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('con 5 parejas: cuadro de 8 y pases directos para las 3 mejores', () => {
    const r = buildBracket(['A', 'B', 'C', 'D', 'E']);
    expect(r.map((x) => x.length)).toEqual([4, 2, 1]);
    expect(r[0]!.map((m) => [m.a, m.b])).toEqual([
      ['A', null],
      ['D', 'E'],
      ['B', null],
      ['C', null],
    ]);
  });
});

describe('inscripción', () => {
  it('solo el admin crea; pareja con amigo que confirma; borrarse', async () => {
    const { d, pushes } = await world(5);
    expect(await createTorneo(d, 'g_1', baseBody(new Date(T0.getTime() + DAY)), T0)).toMatchObject({ ok: false, code: 403 });
    expect(await createTorneo(d, 'g_0', { ...baseBody(new Date(T0.getTime() + DAY)), size: 12 }, T0)).toMatchObject({ ok: false, code: 400 });
    const c = await createTorneo(d, 'g_0', baseBody(new Date(T0.getTime() + DAY)), T0);
    const id = c.ok ? c.value.id : '';
    expect(await signup(d, 'g_1', id, 'g_1', T0)).toMatchObject({ ok: false, code: 400 });
    expect((await signup(d, 'g_1', id, 'g_2', T0)).ok).toBe(true);
    expect(pushes.at(-1)).toEqual({ to: 'g_2', body: 'J1 te ha apuntado de pareja al torneo. ¿Juegas?' });
    expect(await signup(d, 'g_3', id, 'g_2', T0)).toMatchObject({ ok: false, code: 409 }); // g_2 ya está
    expect(await confirmEntry(d, 'g_1', id, T0)).toMatchObject({ ok: false, code: 404 }); // confirma la pareja, no quien apunta
    expect(await confirmEntry(d, 'g_2', id, T0)).toMatchObject({ ok: true });
    expect((await withdraw(d, 'g_2', id)).ok).toBe(true);
    expect((await d.torneos.get(id))!.entries).toEqual([]);
    // Inscripción cerrada.
    expect(await signup(d, 'g_1', id, 'g_2', new Date(T0.getTime() + 2 * DAY))).toMatchObject({ ok: false, code: 409 });
  });

  it('al cerrar la inscripción con menos de 2 parejas se cancela', async () => {
    const { d, id } = await withPairs(1);
    await sweepTorneos(d, new Date(T0.getTime() + DAY + 1));
    expect((await d.torneos.get(id))!.status).toBe('cancelled');
  });
});

describe('torneo completo', () => {
  it('3 parejas: pase directo, cruces, resultado de la mesa, campeón e insignia', async () => {
    const opened: string[] = [];
    const tokens: Record<string, string> = {};
    const tables: TableOps = {
      open: (_t, m) => {
        opened.push(m.id);
        return `T${opened.length}`;
      },
      reserve: (code, seat, who) => (tokens[`${code}:${seat}`] = `${who.name}@${seat}`),
      state: () => 'lobby',
    };
    const { d, id, pushes } = await withPairs(3, tables);
    // Una pareja sin confirmar se queda fuera.
    await signup(d, 'g_7', id, 'g_0', T0);
    expect(await adminAction(d, 'g_1', id, 'start', T0)).toMatchObject({ ok: false, code: 403 });
    const s = await adminAction(d, 'g_0', id, 'start', T0);
    const t = (s.ok ? s.value : null) as Torneo;
    expect(t.status).toBe('running');
    expect(t.entries.length).toBe(3);
    // Nivel: (g_5,g_6) mejor → pase directo a la final.
    const [p12, p34, p56] = t.entries.sort((x, y) => x.a.localeCompare(y.a)).map((e) => e.id);
    expect(t.rounds![0]!.map((m) => [m.a, m.b, m.winner])).toEqual([
      [p56, null, p56],
      [p34, p12, null],
    ]);
    expect(t.rounds![1]![0]).toMatchObject({ a: p56, b: null });
    expect(pushes.filter((x) => x.body.startsWith('Os toca contra')).length).toBe(4);

    // "Ir a la mesa": la pareja A del cruce va a las sillas 0-2, la B a 1-3.
    expect(await goToTable(d, 'g_5', id)).toMatchObject({ ok: false, code: 409 }); // aún no sabe rival
    expect(await goToTable(d, 'g_3', id)).toMatchObject({ ok: true, value: { code: 'T1', token: 'J3@0' } });
    expect(await goToTable(d, 'g_2', id)).toMatchObject({ ok: true, value: { code: 'T1', token: 'J2@3' } });
    expect(opened).toEqual(['r0m1']);

    // Gana la pareja B (equipo 1) 3–1 → a la final.
    expect(await recordTableResult(d, id, 'r0m1', 1, [1, 3], T0)).toBe(true);
    expect(await recordTableResult(d, id, 'r0m1', 0, [3, 1], T0)).toBe(false); // ya tenía resultado
    let now = (await d.torneos.get(id))!;
    expect(now.rounds![1]![0]).toMatchObject({ a: p56, b: p12 });
    // Final: gana p56.
    await recordTableResult(d, id, 'r1m0', 0, [3, 0], T0);
    now = (await d.torneos.get(id))!;
    expect(now).toMatchObject({ status: 'finished', champion: p56 });
    const u5 = (await d.users.get('g_5')) as User & { trophies?: unknown[] };
    expect(u5.trophies).toMatchObject([{ torneoId: id, name: 'Torneo de Navidad' }]);
    expect(pushes.at(-1)!.body).toBe('¡J5 y J6 ganan el torneo! 🏆');
  });

  it('plazo vencido: pasa quien se presentó; si nadie, sorteo; la mesa en juego se respeta', () => {
    const t: Torneo = {
      id: 't',
      name: 'x',
      createdBy: 'a',
      createdAt: '',
      size: 8,
      partidas: 1,
      roundDays: 2,
      signupUntil: '',
      status: 'running',
      entries: [],
      roundDeadlines: [new Date(T0.getTime() + 2 * DAY).toISOString(), new Date(T0.getTime() + 4 * DAY).toISOString()],
      rounds: buildBracket(['A', 'B', 'C', 'D']),
    };
    // Cuadro de 4: (A,D) y (B,C).
    t.rounds![0]![0]!.showed = ['D'];
    t.rounds![0]![1]!.roomCode = 'LIVE';
    expect(resolveDeadlines(t, new Date(T0.getTime() + DAY), () => false).ready).toEqual([]);
    resolveDeadlines(t, new Date(T0.getTime() + 2 * DAY), (c) => c === 'LIVE', () => 0.9);
    expect(t.rounds![0]![0]).toMatchObject({ winner: 'D', result: 'walkover' });
    expect(t.rounds![0]![1]!.winner).toBeNull(); // se está jugando
    resolveDeadlines(t, new Date(T0.getTime() + 2 * DAY), () => false, () => 0.9);
    expect(t.rounds![0]![1]).toMatchObject({ winner: 'C', result: 'sorteo' });
    expect(t.rounds![1]![0]).toMatchObject({ a: 'D', b: 'C' });
  });
});

describe('mesa del cruce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('empieza con los cuatro, sin bots, y al acabar avisa sin revancha', () => {
    const room = createRoom({ code: 'TORN', fillWithBots: false });
    room.isPrivate = true;
    room.tournament = { torneoId: 't1', matchId: 'r0m0', label: 'Navidad · Final' };
    room.format = { partidasPorCoto: 1, cotosParaGanar: 1 };
    const ends: MatchEnd[] = [];
    onMatchEnd(async (e) => {
      ends.push(e);
    });
    const inbox: { type: string; [k: string]: unknown }[] = [];
    for (const seat of [0, 1, 2] as const) {
      reserveSeat(room, seat, { name: `J${seat}`, playerId: `p${seat}` });
      room.players[seat]!.ws = { readyState: 1, send: (s: string) => inbox.push(JSON.parse(s)) } as never;
      scheduleLobbyCheck(room);
    }
    vi.advanceTimersByTime(10 * 60_000);
    expect(room.state).toBeNull(); // falta uno: no hay bots de relleno
    expect(inbox.filter((m) => m.type === 'LOBBY_STATUS').at(-1)).toMatchObject({ tournament: 'Navidad · Final' });
    reserveSeat(room, 3, { name: 'J3', playerId: 'p3' });
    room.players[3]!.ws = { readyState: 1, send: () => undefined } as never;
    scheduleLobbyCheck(room);
    expect(room.state).not.toBeNull();
    const st = room.state!;
    st.phase = 'finished';
    st.matchEnded = true;
    st.matchWinner = 1;
    st.turn = null;
    triggerNextHand(room);
    expect(room.postgame).toBeNull();
    expect(room.matchFinished).toBe(true);
    expect(ends.at(-1)).toMatchObject({ code: 'TORN', winner: 1, reason: 'won', tournament: { matchId: 'r0m0' }, matchWins: { 0: 0, 1: 1 } });
  });
});

describe('rutas', () => {
  it('lista, detalle con tu cruce y apuntarse', async () => {
    const { d, id } = await withPairs(2);
    const app = Fastify();
    registerTorneoRoutes(app, { sessionOf, deps: () => d });
    const c = (uid: string, pid: string) => `${SESSION_COOKIE}=${encodeSession(newSession(uid, pid))}`;
    const list = (await app.inject({ url: '/api/torneos', headers: { cookie: c('g_0', 'p_0') } })).json();
    expect(list).toMatchObject({ canCreate: true, torneos: [{ id, name: 'Torneo de Navidad', status: 'open', pairs: 2 }] });
    const mine = (await app.inject({ url: `/api/torneos/${id}`, headers: { cookie: c('g_1', 'p_1') } })).json();
    expect(mine.my).toMatchObject({ status: 'in', partner: 'J2' });
    expect(mine.entries.map((e: { names: string }) => e.names)).toEqual(['J1 y J2', 'J3 y J4']);
    await app.inject({ method: 'POST', url: `/api/torneos/${id}/start`, headers: { cookie: c('g_0', 'p_0') } });
    const after = (await app.inject({ url: `/api/torneos/${id}`, headers: { cookie: c('g_1', 'p_1') } })).json();
    expect(after.status).toBe('running');
    expect(after.next).toMatchObject({ round: 'Final', rival: 'J3 y J4' });
    expect((await app.inject({ method: 'POST', url: `/api/torneos/${id}/nada`, headers: { cookie: c('g_1', 'p_1') } })).statusCode).toBe(404);
  });
});
