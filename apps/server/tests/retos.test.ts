import { beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { encodeSession, initSessionSecret, newSession, SESSION_COOKIE } from '../src/auth/session.js';
import { MemoryPlayerRepo, MemoryUserRepo, freshPlayer, type User } from '../src/auth/accounts.js';
import { sessionOf } from '../src/auth/routes.js';
import { Presence } from '../src/friends.js';
import { MemoryPenaRepo, createPena, joinByCode, registerPenaRoutes } from '../src/penas.js';
import { MAX_OPEN_RETOS, MemoryRetoRepo, answerReto, countPartida, proposeReto, retosOfPena, sweepRetos, type RetoDeps } from '../src/retos.js';

beforeAll(() => {
  initSessionSecret({ SESSION_SECRET: 'r'.repeat(40) } as NodeJS.ProcessEnv);
});

const DAY = 86_400_000;
const T0 = new Date('2026-10-21T10:00:00Z');

/** Peña A (g_0 lleva, g_1) y peña B (g_2 lleva, g_3). g_4 sin peña, p_9 invitado sin cuenta. */
async function world() {
  const users = new MemoryUserRepo();
  const players = new MemoryPlayerRepo();
  const penas = new MemoryPenaRepo();
  const retos = new MemoryRetoRepo();
  const pushes: { to: string; body: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const now = T0.toISOString();
    const u: User = { id: `g_${i}`, userId: `g_${i}`, provider: 'google', sub: String(i), primaryPlayerId: `p_${i}`, linkedPlayerIds: [`p_${i}`], createdAt: now, lastLoginAt: now };
    await users.put(u);
    await players.put({ ...freshPlayer(`p_${i}`), userId: `g_${i}`, publicName: `J${i}`, tag: String(1000 + i) });
  }
  await players.put(freshPlayer('p_9'));
  const base = { users, players, penas };
  const a = await createPena(base, 'g_0', 'Los del Casino');
  const b = await createPena(base, 'g_2', 'El Cierzo');
  const A = a.ok ? a.value : null!;
  const B = b.ok ? b.value : null!;
  await joinByCode(base, 'g_1', A.code);
  await joinByCode(base, 'g_3', B.code);
  const d: RetoDeps = { ...base, retos, notify: (to, m) => pushes.push({ to, body: m.body }) };
  return { d, A, B, pushes };
}

describe('retos', () => {
  it('proponer, aceptar, contar partidas y terminar al llegar a N', async () => {
    const { d, A, B, pushes } = await world();
    expect(await proposeReto(d, 'g_1', B.id, 5, T0)).toMatchObject({ ok: false, code: 403 }); // no lleva la peña
    expect(await proposeReto(d, 'g_0', B.id, 7, T0)).toMatchObject({ ok: false, code: 400 });
    const p = await proposeReto(d, 'g_0', B.id, 5, T0);
    expect(p.ok).toBe(true);
    const id = p.ok ? p.value.id : '';
    expect(pushes.at(-1)).toEqual({ to: 'g_2', body: 'La peña «Los del Casino» reta a «El Cierzo» a 5 partidas' });
    expect(await proposeReto(d, 'g_0', B.id, 5, T0)).toMatchObject({ ok: false, code: 409 }); // ya hay uno abierto
    expect(await answerReto(d, 'g_0', id, 'accept', T0)).toMatchObject({ ok: false, code: 403 }); // no es la retada
    const acc = await answerReto(d, 'g_2', id, 'accept', T0);
    expect(acc).toMatchObject({ ok: true, value: { status: 'active' } });
    expect(pushes.filter((x) => x.body.startsWith('«Los del Casino» contra')).length).toBe(4); // los 4 miembros

    // Partidas que NO cuentan: equipos mezclados, invitado sin cuenta, alguien sin peña, misma peña.
    expect(await countPartida(d, { 0: ['p_0', 'p_2'], 1: ['p_1', 'p_3'] }, 0, T0)).toEqual([]);
    expect(await countPartida(d, { 0: ['p_0', 'p_9'], 1: ['p_2'] }, 0, T0)).toEqual([]);
    expect(await countPartida(d, { 0: ['p_0'], 1: ['p_4'] }, 0, T0)).toEqual([]);
    expect(await countPartida(d, { 0: ['p_0'], 1: ['p_1'] }, 0, T0)).toEqual([]);

    // Cuentan (los huecos pueden ser bots).
    await countPartida(d, { 0: ['p_0', 'p_1'], 1: ['p_2', 'p_3'] }, 0, T0); // A gana
    await countPartida(d, { 0: ['p_3'], 1: ['p_1'] }, 0, T0); // B gana (B en el equipo 0)
    await countPartida(d, { 0: ['p_0'], 1: ['p_2'] }, 0, T0); // A
    await countPartida(d, { 0: ['p_0'], 1: ['p_2'] }, 0, T0); // A
    const last = await countPartida(d, { 0: ['p_0'], 1: ['p_2'] }, 1, T0); // B → 3–2, quinta partida
    expect(last[0]).toMatchObject({ status: 'finished', score: { from: 3, to: 2 }, winner: 'from' });
    expect(pushes.at(-1)!.body).toBe('«Los del Casino» gana el reto 3–2 a «El Cierzo»');
    // Ya no cuenta más.
    expect(await countPartida(d, { 0: ['p_0'], 1: ['p_2'] }, 0, T0)).toEqual([]);

    const vA = await retosOfPena(d, A.id, T0);
    expect(vA[0]).toMatchObject({ rivalName: 'El Cierzo', weChallenged: true, us: 3, them: 2, result: 'win' });
    const vB = await retosOfPena(d, B.id, T0);
    expect(vB[0]).toMatchObject({ rivalName: 'Los del Casino', weChallenged: false, us: 2, them: 3, result: 'lose' });
  });

  it('plazos: la propuesta caduca a los 3 días; el reto termina a los 7 (empate)', async () => {
    const { d, B } = await world();
    const p1 = await proposeReto(d, 'g_0', B.id, 10, T0);
    const id1 = p1.ok ? p1.value.id : '';
    expect(await sweepRetos(d, new Date(T0.getTime() + 3 * DAY + 1))).toBe(1);
    expect(await d.retos.get(id1)).toMatchObject({ status: 'expired' });

    const p2 = await proposeReto(d, 'g_0', B.id, 10, T0);
    const id2 = p2.ok ? p2.value.id : '';
    await answerReto(d, 'g_2', id2, 'accept', T0);
    await countPartida(d, { 0: ['p_0'], 1: ['p_2'] }, 0, T0);
    await countPartida(d, { 0: ['p_0'], 1: ['p_2'] }, 1, T0);
    expect(await sweepRetos(d, new Date(T0.getTime() + 6 * DAY))).toBe(0);
    expect(await sweepRetos(d, new Date(T0.getTime() + 7 * DAY))).toBe(1);
    expect(await d.retos.get(id2)).toMatchObject({ status: 'finished', winner: 'draw', score: { from: 1, to: 1 } });
  });

  it('rechazar, cancelar y límite de retos abiertos', async () => {
    const { d, B } = await world();
    const p = await proposeReto(d, 'g_0', B.id, 5, T0);
    const id = p.ok ? p.value.id : '';
    expect(await answerReto(d, 'g_2', id, 'cancel', T0)).toMatchObject({ ok: false, code: 403 });
    expect(await answerReto(d, 'g_2', id, 'decline', T0)).toMatchObject({ ok: true, value: { status: 'declined' } });
    const p2 = await proposeReto(d, 'g_0', B.id, 5, T0);
    expect(await answerReto(d, 'g_0', p2.ok ? p2.value.id : '', 'cancel', T0)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    // Límite: A con MAX_OPEN_RETOS abiertos contra peñas nuevas.
    for (let i = 0; i < MAX_OPEN_RETOS; i++) {
      await d.penas.put({ id: `x${i}`, name: `Otra ${i}`, municipio: null, ownerId: `o${i}`, members: [], code: `XX000${i}`, createdAt: '' });
      expect((await proposeReto(d, 'g_0', `x${i}`, 5, T0)).ok).toBe(true);
    }
    expect(await proposeReto(d, 'g_0', B.id, 5, T0)).toMatchObject({ ok: false, code: 409 });
  });
});

describe('rutas', () => {
  it('buscar peña, retar y aceptar; la página de la peña enseña el reto', async () => {
    const { d, B } = await world();
    const app = Fastify();
    registerPenaRoutes(app, {
      sessionOf,
      deps: () => ({ users: d.users, players: d.players, penas: d.penas }),
      presence: new Presence(),
      playingPlayerIds: () => new Set(),
      retos: () => d.retos,
    });
    const c0 = `${SESSION_COOKIE}=${encodeSession(newSession('g_0', 'p_0'))}`;
    const c2 = `${SESSION_COOKIE}=${encodeSession(newSession('g_2', 'p_2'))}`;
    const found = (await app.inject({ url: '/api/penas/search?q=cierzo', headers: { cookie: c0 } })).json();
    expect(found.results).toMatchObject([{ id: B.id, name: 'El Cierzo', members: 2 }]);
    expect((await app.inject({ url: '/api/penas/search?q=casino', headers: { cookie: c0 } })).json().results).toEqual([]); // la tuya no
    const mine = (await app.inject({ method: 'POST', url: '/api/penas/retos', headers: { cookie: c0 }, payload: { toPenaId: B.id, games: 10 } })).json();
    expect(mine.pena.retos).toMatchObject([{ rivalName: 'El Cierzo', status: 'pending', weChallenged: true }]);
    const theirs = (await app.inject({ url: '/api/penas/mine', headers: { cookie: c2 } })).json();
    const id = theirs.pena.retos[0].id;
    const acc = (await app.inject({ method: 'POST', url: `/api/penas/retos/${id}/accept`, headers: { cookie: c2 } })).json();
    expect(acc.pena.retos[0]).toMatchObject({ status: 'active', us: 0, them: 0, games: 10 });
    expect((await app.inject({ method: 'POST', url: `/api/penas/retos/${id}/explode`, headers: { cookie: c2 } })).statusCode).toBe(404);
  });
});
