import { beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { encodeSession, initSessionSecret, newSession, SESSION_COOKIE } from '../src/auth/session.js';
import { MemoryPlayerRepo, MemoryUserRepo, freshPlayer, type User } from '../src/auth/accounts.js';
import { sessionOf } from '../src/auth/routes.js';
import {
  INVITE_TTL_MS,
  InviteBox,
  ONLINE_WINDOW_MS,
  Presence,
  acceptRequest,
  forgetUser,
  friendsView,
  parseFriendCode,
  registerFriendRoutes,
  sendRequest,
  unlink,
} from '../src/friends.js';

beforeAll(() => {
  initSessionSecret({ SESSION_SECRET: 'y'.repeat(40) } as NodeJS.ProcessEnv);
});

async function world(names: string[]) {
  const users = new MemoryUserRepo();
  const players = new MemoryPlayerRepo();
  const ids: string[] = [];
  for (const [i, n] of names.entries()) {
    const uid = `g_${i}`;
    const pid = `p_${i}`;
    const now = new Date().toISOString();
    const u: User = { id: uid, userId: uid, provider: 'google', sub: String(i), primaryPlayerId: pid, linkedPlayerIds: [pid], createdAt: now, lastLoginAt: now };
    await users.put(u);
    await players.put({ ...freshPlayer(pid), userId: uid, publicName: n, tag: String(1000 + i) });
    ids.push(uid);
  }
  return { users, players, ids };
}

const cookieFor = (uid: string, pid: string) => `${SESSION_COOKIE}=${encodeSession(newSession(uid, pid))}`;

describe('código de amigo', () => {
  it('lee Nombre#1234 con espacios y tildes', () => {
    expect(parseFriendCode('Pilar#1234')).toEqual({ name: 'Pilar', tag: '1234' });
    expect(parseFriendCode('  José  Mari # 0042 ')).toEqual({ name: 'José Mari', tag: '0042' });
    expect(parseFriendCode('Pilar')).toBeNull();
    expect(parseFriendCode('Pilar#12')).toBeNull();
    expect(parseFriendCode(42)).toBeNull();
  });
});

describe('solicitudes', () => {
  it('enviar, aceptar y quitar', async () => {
    const { users, players, ids } = await world(['Josevi', 'Pilar']);
    const [a, b] = ids as [string, string];
    expect(await sendRequest(users, players, a, 'pilar#1001')).toMatchObject({ ok: true, status: 'sent' });
    expect(await sendRequest(users, players, a, 'Pilar#1001')).toMatchObject({ ok: true, status: 'already-sent' });
    expect((await users.get(b)) as unknown).toMatchObject({ friendsIn: [a] });
    expect(await acceptRequest(users, b, a)).toMatchObject({ ok: true, status: 'friends' });
    const ua = (await users.get(a)) as User & { friends?: string[]; friendsOut?: string[] };
    expect(ua.friends).toEqual([b]);
    expect(ua.friendsOut).toEqual([]);
    expect(await sendRequest(users, players, a, 'Pilar#1001')).toMatchObject({ status: 'already-friends' });
    expect(await unlink(users, b, a)).toBe(true);
    expect(((await users.get(a)) as { friends?: string[] }).friends).toEqual([]);
  });

  it('si los dos se envían solicitud, quedan amigos', async () => {
    const { users, players, ids } = await world(['Josevi', 'Pilar']);
    const [a, b] = ids as [string, string];
    await sendRequest(users, players, a, 'Pilar#1001');
    expect(await sendRequest(users, players, b, 'Josevi#1000')).toMatchObject({ ok: true, status: 'friends' });
    expect(((await users.get(b)) as { friends?: string[] }).friends).toEqual([a]);
  });

  it('errores: código raro, nadie, a ti mismo, invitados', async () => {
    const { users, players, ids } = await world(['Josevi']);
    await players.put({ ...freshPlayer('anon'), publicName: 'Invitado', tag: '7777' }); // sin cuenta
    expect(await sendRequest(users, players, ids[0]!, 'xx')).toMatchObject({ ok: false, code: 400 });
    expect(await sendRequest(users, players, ids[0]!, 'Nadie#9999')).toMatchObject({ ok: false, code: 404 });
    expect(await sendRequest(users, players, ids[0]!, 'Invitado#7777')).toMatchObject({ ok: false, code: 404 });
    expect(await sendRequest(users, players, ids[0]!, 'Josevi#1000')).toMatchObject({ ok: false, code: 400 });
  });

  it('borrar la cuenta la saca de las listas de los demás', async () => {
    const { users, players, ids } = await world(['A', 'B', 'C']);
    const [a, b, c] = ids as [string, string, string];
    await sendRequest(users, players, a, 'B#1001');
    await acceptRequest(users, b, a);
    await sendRequest(users, players, c, 'A#1000');
    await forgetUser(users, a);
    expect(((await users.get(b)) as { friends?: string[] }).friends).toEqual([]);
    expect(((await users.get(c)) as { friendsOut?: string[] }).friendsOut).toEqual([]);
  });
});

describe('presencia e invitaciones', () => {
  it('conectado durante un minuto', () => {
    const p = new Presence();
    p.touch('u', 1000);
    expect(p.isOnline('u', 1000 + ONLINE_WINDOW_MS)).toBe(true);
    expect(p.isOnline('u', 1001 + ONLINE_WINDOW_MS)).toBe(false);
  });
  it('las invitaciones caducan y la nueva sustituye a la vieja', () => {
    const box = new InviteBox();
    box.add({ fromId: 'a', fromName: 'A', toId: 'b', kind: 'pareja', code: 'AAAA' }, 0);
    box.add({ fromId: 'a', fromName: 'A', toId: 'b', kind: 'mesa', code: 'BBBB' }, 10);
    expect(box.forUser('b', 20).map((i) => i.code)).toEqual(['BBBB']);
    expect(box.forUser('b', 10 + INVITE_TTL_MS)).toEqual([]);
  });
  it('la vista ordena: conectados, jugando, desconectados', async () => {
    const { users, players, ids } = await world(['Yo', 'Zoe', 'Ana', 'Luis']);
    const [me, z, a, l] = ids as [string, string, string, string];
    for (const [o, code] of [[z, 'Zoe#1001'], [a, 'Ana#1002'], [l, 'Luis#1003']] as const) {
      await sendRequest(users, players, me, code);
      await acceptRequest(users, o, me);
    }
    const presence = new Presence();
    presence.touch(z, 100);
    const v = await friendsView({ users, players, presence, invites: new InviteBox(), playingPlayerIds: () => new Set(['p_2']) }, me, 100);
    expect(v!.friends.map((f) => [f.name, f.status])).toEqual([
      ['Zoe', 'online'],
      ['Ana', 'playing'],
      ['Luis', 'offline'],
    ]);
    expect(v!.me).toEqual({ name: 'Yo', tag: '1000' });
  });
});

describe('rutas', () => {
  async function makeApp(canInvite = true) {
    const w = await world(['Josevi', 'Pilar']);
    const app = Fastify();
    const presence = new Presence();
    registerFriendRoutes(app, {
      repos: () => ({ users: w.users, players: w.players }),
      sessionOf,
      presence,
      invites: new InviteBox(),
      playingPlayerIds: () => new Set(),
      canInvite: () => canInvite,
    });
    return { app, ...w, presence, ca: cookieFor('g_0', 'p_0'), cb: cookieFor('g_1', 'p_1') };
  }

  it('sin sesión: 401', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ url: '/api/friends' })).statusCode).toBe(401);
  });

  it('flujo completo con invitación', async () => {
    const { app, ca, cb, presence } = await makeApp();
    const r = await app.inject({ method: 'POST', url: '/api/friends/request', headers: { cookie: ca }, payload: { code: 'Pilar#1001' } });
    expect(r.json()).toEqual({ status: 'sent' });
    const vb = (await app.inject({ url: '/api/friends', headers: { cookie: cb } })).json();
    expect(vb.incoming.map((x: { name: string }) => x.name)).toEqual(['Josevi']);
    expect((await app.inject({ method: 'POST', url: '/api/friends/g_0/accept', headers: { cookie: cb } })).json()).toEqual({ status: 'friends' });
    // Pilar ha hecho peticiones: está conectada.
    expect(presence.isOnline('g_1')).toBe(true);
    const va = (await app.inject({ url: '/api/friends', headers: { cookie: ca } })).json();
    expect(va.friends).toMatchObject([{ id: 'g_1', name: 'Pilar', tag: '1001', status: 'online' }]);

    const inv = await app.inject({ method: 'POST', url: '/api/friends/g_1/invite', headers: { cookie: ca }, payload: { kind: 'pareja', code: 'abcd' } });
    expect(inv.statusCode).toBe(200);
    const got = (await app.inject({ url: '/api/friends', headers: { cookie: cb } })).json();
    expect(got.invites).toMatchObject([{ fromName: 'Josevi', kind: 'pareja', code: 'ABCD' }]);
    await app.inject({ method: 'POST', url: `/api/invites/${got.invites[0].id}/dismiss`, headers: { cookie: cb } });
    expect((await app.inject({ url: '/api/friends', headers: { cookie: cb } })).json().invites).toEqual([]);

    // Quitar amigo: ya no se puede invitar.
    await app.inject({ method: 'DELETE', url: '/api/friends/g_1', headers: { cookie: ca } });
    const no = await app.inject({ method: 'POST', url: '/api/friends/g_1/invite', headers: { cookie: ca }, payload: { kind: 'pareja', code: 'ABCD' } });
    expect(no.statusCode).toBe(404);
  });

  it('no invita a una pareja llena', async () => {
    const { app, ca, cb } = await makeApp(false);
    await app.inject({ method: 'POST', url: '/api/friends/request', headers: { cookie: ca }, payload: { code: 'Pilar#1001' } });
    await app.inject({ method: 'POST', url: '/api/friends/g_0/accept', headers: { cookie: cb } });
    const r = await app.inject({ method: 'POST', url: '/api/friends/g_1/invite', headers: { cookie: ca }, payload: { kind: 'pareja', code: 'ABCD' } });
    expect(r.statusCode).toBe(409);
  });
});

describe('añadir amigo desde la mesa', () => {
  it('solo ves a los de tu mesa con cuenta; la solicitud llega con aviso', async () => {
    const w = await world(['Josevi', 'Pilar', 'Ramiro']);
    await w.players.put({ ...freshPlayer('anon'), publicName: 'Invitado' }); // sin cuenta
    const seats = [
      { seat: 0, playerId: 'p_0' },
      { seat: 1, playerId: 'p_1' },
      { seat: 2, playerId: 'anon' },
      { seat: 3, playerId: null }, // bot
    ];
    const app = Fastify();
    const pushes: string[] = [];
    registerFriendRoutes(app, {
      repos: () => ({ users: w.users, players: w.players }),
      sessionOf,
      presence: new Presence(),
      invites: new InviteBox(),
      playingPlayerIds: () => new Set(),
      canInvite: () => true,
      tableSeats: (code) => (code === 'MESA' ? seats : null),
      notify: (to, _k, m) => pushes.push(`${to}: ${m.body}`),
    });
    const c0 = cookieFor('g_0', 'p_0');
    expect((await app.inject({ url: '/api/friends/table/mesa', headers: { cookie: c0 } })).json()).toEqual({ seats: [{ seat: 1, relation: 'none' }] });
    // Alguien que no está sentado en la mesa no ve nada ni puede pedir.
    const c2 = cookieFor('g_2', 'p_2');
    expect((await app.inject({ url: '/api/friends/table/MESA', headers: { cookie: c2 } })).json()).toEqual({ seats: [] });
    expect((await app.inject({ method: 'POST', url: '/api/friends/table/MESA/1', headers: { cookie: c2 } })).statusCode).toBe(403);
    // Invitado sin cuenta y bot: no.
    expect((await app.inject({ method: 'POST', url: '/api/friends/table/MESA/2', headers: { cookie: c0 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/friends/table/MESA/3', headers: { cookie: c0 } })).statusCode).toBe(404);
    // A Pilar sí.
    expect((await app.inject({ method: 'POST', url: '/api/friends/table/MESA/1', headers: { cookie: c0 } })).json()).toEqual({ status: 'sent' });
    expect(pushes).toEqual(['g_1: Josevi quiere ser tu amigo en el guiñote']);
    expect((await app.inject({ url: '/api/friends/table/MESA', headers: { cookie: c0 } })).json()).toEqual({ seats: [{ seat: 1, relation: 'sent' }] });
    // Pilar lo ve como solicitud recibida y, si pide ella, quedan amigos.
    const c1 = cookieFor('g_1', 'p_1');
    expect((await app.inject({ url: '/api/friends/table/MESA', headers: { cookie: c1 } })).json()).toEqual({ seats: [{ seat: 0, relation: 'incoming' }] });
    expect((await app.inject({ method: 'POST', url: '/api/friends/table/MESA/0', headers: { cookie: c1 } })).json()).toEqual({ status: 'friends' });
    expect((await app.inject({ url: '/api/friends/table/nada', headers: { cookie: c1 } })).statusCode).toBe(404);
  });
});
