import { beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { encodeSession, initSessionSecret, newSession, SESSION_COOKIE } from '../src/auth/session.js';
import { MemoryPlayerRepo, MemoryUserRepo, freshPlayer, type User } from '../src/auth/accounts.js';
import { sessionOf } from '../src/auth/routes.js';
import { InviteBox, Presence, acceptRequest, registerFriendRoutes, sendRequest } from '../src/friends.js';
import {
  MAX_MEMBERS,
  MemoryPenaRepo,
  cleanPenaName,
  createPena,
  inviteToPena,
  joinByCode,
  kickMember,
  leavePena,
  penaMatesOf,
  penaView,
  registerPenaRoutes,
  acceptInvite,
  type PenaUser,
} from '../src/penas.js';
import { weekId } from '@guinote/protocol';

beforeAll(() => {
  initSessionSecret({ SESSION_SECRET: 'p'.repeat(40) } as NodeJS.ProcessEnv);
});

async function world(names: string[]) {
  const users = new MemoryUserRepo();
  const players = new MemoryPlayerRepo();
  const penas = new MemoryPenaRepo();
  for (const [i, n] of names.entries()) {
    const now = new Date().toISOString();
    const u: User = { id: `g_${i}`, userId: `g_${i}`, provider: 'google', sub: String(i), primaryPlayerId: `p_${i}`, linkedPlayerIds: [`p_${i}`], createdAt: now, lastLoginAt: now };
    await users.put(u);
    await players.put({ ...freshPlayer(`p_${i}`), userId: `g_${i}`, publicName: n, tag: String(1000 + i), place: { province: '44', municipio: '44013' } });
  }
  return { users, players, penas };
}
const pu = async (users: MemoryUserRepo, id: string) => (await users.get(id)) as PenaUser;
const cookie = (uid: string, pid: string) => `${SESSION_COOKIE}=${encodeSession(newSession(uid, pid))}`;

describe('nombre', () => {
  it('limpia y valida', () => {
    expect(cleanPenaName('  Los   del Bar  ')).toBe('Los del Bar');
    expect(cleanPenaName('ab')).toBeNull();
    expect(cleanPenaName(3)).toBeNull();
  });
});

describe('peñas', () => {
  it('crear, entrar con enlace, una sola peña por persona', async () => {
    const d = await world(['A', 'B', 'C']);
    const r = await createPena(d, 'g_0', 'Los del Casino');
    expect(r.ok).toBe(true);
    const pena = r.ok ? r.value : null!;
    expect(pena.municipio).toBe('44013');
    expect((await pu(d.users, 'g_0')).penaId).toBe(pena.id);
    expect(await createPena(d, 'g_0', 'Otra')).toMatchObject({ ok: false, code: 409 });
    expect(await joinByCode(d, 'g_1', pena.code.toLowerCase())).toMatchObject({ ok: true });
    expect(await joinByCode(d, 'g_1', pena.code)).toMatchObject({ ok: true }); // repetir no duplica
    expect((await d.penas.get(pena.id))!.members.length).toBe(2);
    await createPena(d, 'g_2', 'La Cuadrilla');
    expect(await joinByCode(d, 'g_2', pena.code)).toMatchObject({ ok: false, code: 409 });
    expect(await joinByCode(d, 'g_2', 'ZZZZZZ')).toMatchObject({ ok: false, code: 404 });
    expect(await penaMatesOf(d, 'g_0')).toEqual(['g_1']);
  });

  it('invitar, aceptar; expulsar solo el creador; al irse el creador pasa al más antiguo', async () => {
    const d = await world(['A', 'B', 'C']);
    const r = await createPena(d, 'g_0', 'Peña El Cierzo', new Date('2026-10-01'));
    const pena = r.ok ? r.value : null!;
    expect(await inviteToPena(d, 'g_0', 'g_1')).toMatchObject({ ok: true });
    expect((await pu(d.users, 'g_1')).penaInvites).toEqual([pena.id]);
    expect(await acceptInvite(d, 'g_1', pena.id, new Date('2026-10-02'))).toMatchObject({ ok: true });
    expect((await pu(d.users, 'g_1')).penaInvites).toEqual([]);
    await joinByCode(d, 'g_2', pena.code, new Date('2026-10-03'));
    expect(await kickMember(d, 'g_1', 'g_2')).toMatchObject({ ok: false, code: 403 });
    expect(await kickMember(d, 'g_0', 'g_2')).toMatchObject({ ok: true });
    expect((await pu(d.users, 'g_2')).penaId).toBeUndefined();
    await joinByCode(d, 'g_2', pena.code, new Date('2026-10-04'));
    await leavePena(d, 'g_0');
    expect((await d.penas.get(pena.id))!.ownerId).toBe('g_1');
    await leavePena(d, 'g_1');
    await leavePena(d, 'g_2');
    expect(await d.penas.get(pena.id)).toBeNull();
  });

  it(`como mucho ${MAX_MEMBERS} miembros`, async () => {
    const d = await world(['A', 'B']);
    const r = await createPena(d, 'g_0', 'Llena');
    const pena = r.ok ? r.value : null!;
    await d.penas.put({ ...pena, members: Array.from({ length: MAX_MEMBERS }, (_, i) => ({ userId: `x${i}`, joinedAt: '2026' })) });
    expect(await joinByCode(d, 'g_1', pena.code)).toMatchObject({ ok: false, code: 409 });
  });

  it('vista: ranking por nivel, puntos de la semana y quién está conectado', async () => {
    const d = await world(['Ana', 'Bea', 'Carlos']);
    const r = await createPena(d, 'g_0', 'Los del Bar');
    const pena = r.ok ? r.value : null!;
    await joinByCode(d, 'g_1', pena.code);
    await joinByCode(d, 'g_2', pena.code);
    const now = new Date();
    const wk = weekId(now);
    const p1 = (await d.players.get('p_1'))!;
    await d.players.put({ ...p1, rating: 1210, games: 30, weekId: wk, weekPoints: 42, weekGames: 5 });
    const presence = new Presence();
    presence.touch('g_2', now.getTime());
    const v = await penaView(d, { presence, playingPlayerIds: () => new Set(['p_0']) }, (await d.penas.get(pena.id))!, 'g_0', now);
    expect(v.placeName).toBe('Alcañiz');
    expect(v.youAreOwner).toBe(true);
    expect(v.members.map((m) => [m.name, m.status, m.division, m.weekPoints])).toEqual([
      ['Bea', 'offline', 'maestro', 42],
      ['Ana', 'playing', null, 0],
      ['Carlos', 'online', null, 0],
    ]);
  });
});

describe('rutas y amigos', () => {
  it('flujo con enlace; los de la peña salen en amigos para invitar a jugar', async () => {
    const d = await world(['Ana', 'Bea']);
    const app = Fastify();
    const presence = new Presence();
    const pushes: string[] = [];
    registerPenaRoutes(app, { sessionOf, deps: () => d, presence, playingPlayerIds: () => new Set(), notify: (_to, _k, m) => pushes.push(m.body) });
    registerFriendRoutes(app, {
      repos: () => ({ users: d.users, players: d.players }),
      sessionOf,
      presence,
      invites: new InviteBox(),
      playingPlayerIds: () => new Set(),
      canInvite: () => true,
      penaMates: (me) => penaMatesOf(d, me),
    });
    const ca = cookie('g_0', 'p_0');
    const cb = cookie('g_1', 'p_1');
    expect((await app.inject({ url: '/api/penas/mine' })).statusCode).toBe(401);
    const created = (await app.inject({ method: 'POST', url: '/api/penas', headers: { cookie: ca }, payload: { name: 'Los del Bar' } })).json();
    expect(created.pena).toMatchObject({ name: 'Los del Bar', placeName: 'Alcañiz', youAreOwner: true });
    const code = created.pena.code as string;
    expect((await app.inject({ url: `/api/penas/join/${code}` })).json()).toEqual({ name: 'Los del Bar', placeName: 'Alcañiz', members: 1, youAreIn: false });
    // Invitar a alguien que no es amigo: no.
    expect((await app.inject({ method: 'POST', url: '/api/penas/mine/invite/g_1', headers: { cookie: ca } })).statusCode).toBe(404);
    const joined = (await app.inject({ method: 'POST', url: `/api/penas/join/${code}`, headers: { cookie: cb } })).json();
    expect(joined.pena.members.length).toBe(2);
    // Bea no es amiga de Ana, pero al ser de la peña puede invitarla a jugar.
    const fv = (await app.inject({ url: '/api/friends', headers: { cookie: cb } })).json();
    expect(fv.mates.map((m: { name: string }) => m.name)).toEqual(['Ana']);
    expect((await app.inject({ method: 'POST', url: '/api/friends/g_0/invite', headers: { cookie: cb }, payload: { kind: 'pareja', code: 'ABCD' } })).statusCode).toBe(200);
    const left = (await app.inject({ method: 'POST', url: '/api/penas/mine/leave', headers: { cookie: cb } })).json();
    expect(left.pena).toBeNull();
  });

  it('invitar a un amigo manda aviso', async () => {
    const d = await world(['Ana', 'Bea']);
    await sendRequest(d.users, d.players, 'g_0', 'Bea#1001');
    await acceptRequest(d.users, 'g_1', 'g_0');
    const app = Fastify();
    const pushes: string[] = [];
    registerPenaRoutes(app, { sessionOf, deps: () => d, presence: new Presence(), playingPlayerIds: () => new Set(), notify: (_to, _k, m) => pushes.push(m.body) });
    const ca = cookie('g_0', 'p_0');
    await app.inject({ method: 'POST', url: '/api/penas', headers: { cookie: ca }, payload: { name: 'Los del Bar' } });
    expect((await app.inject({ method: 'POST', url: '/api/penas/mine/invite/g_1', headers: { cookie: ca } })).json()).toEqual({ ok: true });
    expect(pushes).toEqual(['Ana te invita a la peña «Los del Bar»']);
    const mine = (await app.inject({ url: '/api/penas/mine', headers: { cookie: cookie('g_1', 'p_1') } })).json();
    expect(mine.invites).toMatchObject([{ name: 'Los del Bar', members: 1 }]);
  });
});
