import { beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { encodeSession, initSessionSecret, newSession, SESSION_COOKIE } from '../src/auth/session.js';
import { MemoryPlayerRepo, MemoryUserRepo, freshPlayer, type User } from '../src/auth/accounts.js';
import { sessionOf } from '../src/auth/routes.js';
import { InviteBox, Presence, registerFriendRoutes } from '../src/friends.js';
import { MAX_DEVICES, MemoryPushRepo, Pusher, parseSubscription, registerPushRoutes, subId, type PushSender } from '../src/push.js';

beforeAll(() => {
  initSessionSecret({ SESSION_SECRET: 'q'.repeat(40) } as NodeJS.ProcessEnv);
});

const SUB = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/abc${n}`, keys: { p256dh: 'BPx_key-' + n + 'AAAAAAAA', auth: 'authAAAA' + n } });
const cookie = (uid: string, pid: string) => `${SESSION_COOKIE}=${encodeSession(newSession(uid, pid))}`;

async function world() {
  const users = new MemoryUserRepo();
  const players = new MemoryPlayerRepo();
  for (const [i, n] of ['Josevi', 'Pilar'].entries()) {
    const now = new Date().toISOString();
    const u: User = { id: `g_${i}`, userId: `g_${i}`, provider: 'google', sub: String(i), primaryPlayerId: `p_${i}`, linkedPlayerIds: [`p_${i}`], createdAt: now, lastLoginAt: now };
    await users.put(u);
    await players.put({ ...freshPlayer(`p_${i}`), userId: `g_${i}`, publicName: n, tag: String(1000 + i) });
  }
  return { users, players };
}

describe('suscripciones', () => {
  it('valida lo que manda el navegador', () => {
    expect(parseSubscription(SUB(1))).toEqual(SUB(1));
    expect(parseSubscription({ ...SUB(1), endpoint: 'http://inseguro/x' })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://x/y', keys: {} })).toBeNull();
    expect(parseSubscription('x')).toBeNull();
  });
});

describe('Pusher', () => {
  it('envía a todos los dispositivos, respeta preferencias y borra los caducados', async () => {
    const { users } = await world();
    const repo = new MemoryPushRepo();
    for (const n of [1, 2]) await repo.put({ id: subId(SUB(n).endpoint), userId: 'g_1', ...SUB(n), createdAt: String(n) });
    const sent: string[] = [];
    const sender: PushSender = async (sub, payload) => {
      if (sub.endpoint.endsWith('abc2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push(JSON.parse(payload).body);
    };
    const pusher = new Pusher(() => repo, () => users, sender);
    const msg = { title: 't', body: 'hola', url: '/#amigos', tag: 'x', ttl: 60 };
    expect(await pusher.notify('g_1', 'invite', msg)).toBe(1);
    expect(sent).toEqual(['hola']);
    expect((await repo.list('g_1')).length).toBe(1); // el 410 se borró
    const u = (await users.get('g_1'))!;
    await users.put({ ...u, pushPrefs: { invite: false, request: true } } as User);
    expect(await pusher.notify('g_1', 'invite', msg)).toBe(0);
    expect(await pusher.notify('g_1', 'request', msg)).toBe(1);
    expect(await new Pusher(() => repo, () => users, null).notify('g_1', 'request', msg)).toBe(0);
  });
});

describe('rutas', () => {
  async function makeApp(publicKey: string | null = 'PUB') {
    const w = await world();
    const repo = new MemoryPushRepo();
    const app = Fastify();
    registerPushRoutes(app, { sessionOf, users: () => w.users, repo: () => repo, publicKey });
    return { app, repo, ...w };
  }

  it('config, alta, preferencias y baja', async () => {
    const { app, repo } = await makeApp();
    const c = cookie('g_0', 'p_0');
    expect((await app.inject({ url: '/api/push/config' })).json()).toEqual({ publicKey: 'PUB' });
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { subscription: SUB(1) } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie: c }, payload: { subscription: { endpoint: 'x' } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie: c }, payload: { subscription: SUB(1) } })).json()).toEqual({ ok: true });
    // Repetir el mismo dispositivo no duplica.
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie: c }, payload: { subscription: SUB(1) } });
    expect((await repo.list('g_0')).length).toBe(1);
    expect((await app.inject({ url: '/api/push/prefs', headers: { cookie: c } })).json()).toEqual({ invite: true, request: true, devices: 1 });
    expect((await app.inject({ method: 'PUT', url: '/api/push/prefs', headers: { cookie: c }, payload: { request: false } })).json()).toEqual({ invite: true, request: false });
    await app.inject({ method: 'POST', url: '/api/push/unsubscribe', headers: { cookie: c }, payload: { endpoint: SUB(1).endpoint } });
    expect(await repo.list('g_0')).toEqual([]);
  });

  it(`como mucho ${MAX_DEVICES} dispositivos`, async () => {
    const { app, repo } = await makeApp();
    const c = cookie('g_0', 'p_0');
    for (let i = 0; i < MAX_DEVICES + 3; i++) {
      await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie: c }, payload: { subscription: SUB(i) } });
    }
    expect((await repo.list('g_0')).length).toBe(MAX_DEVICES);
  });

  it('sin claves VAPID: 503', async () => {
    const { app } = await makeApp(null);
    const r = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie: cookie('g_0', 'p_0') }, payload: { subscription: SUB(1) } });
    expect(r.statusCode).toBe(503);
  });
});

describe('avisos desde amigos', () => {
  it('solicitud siempre; invitación solo si no tiene la web abierta', async () => {
    const w = await world();
    const app = Fastify();
    const presence = new Presence();
    const got: { to: string; kind: string; body: string; url: string }[] = [];
    registerFriendRoutes(app, {
      repos: () => ({ users: w.users, players: w.players }),
      sessionOf,
      presence,
      invites: new InviteBox(),
      playingPlayerIds: () => new Set(),
      canInvite: () => true,
      notify: (to, kind, msg) => got.push({ to, kind, body: msg.body, url: msg.url }),
    });
    const ca = cookie('g_0', 'p_0');
    const cb = cookie('g_1', 'p_1');
    await app.inject({ method: 'POST', url: '/api/friends/request', headers: { cookie: ca }, payload: { code: 'Pilar#1001' } });
    expect(got).toEqual([{ to: 'g_1', kind: 'request', body: 'Josevi quiere ser tu amigo en el guiñote', url: '/#amigos' }]);
    await app.inject({ method: 'POST', url: '/api/friends/g_0/accept', headers: { cookie: cb } }); // Pilar queda "conectada"
    await app.inject({ method: 'POST', url: '/api/friends/g_1/invite', headers: { cookie: ca }, payload: { kind: 'pareja', code: 'ABCD' } });
    expect(got.length).toBe(1);
    presence.forget('g_1');
    await app.inject({ method: 'POST', url: '/api/friends/g_1/invite', headers: { cookie: ca }, payload: { kind: 'mesa', code: 'K7PQ' } });
    expect(got[1]).toEqual({ to: 'g_1', kind: 'invite', body: 'Josevi te invita a su mesa privada', url: '/#K7PQ' });
  });
});
