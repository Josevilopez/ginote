import { describe, expect, it, beforeAll } from 'vitest';
import Fastify from 'fastify';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import {
  decodeSession,
  encodeSession,
  initSessionSecret,
  newSession,
  readCookie,
  SESSION_COOKIE,
} from '../src/auth/session.js';
import { verifyGoogleIdToken, GoogleTokenError, type Jwk } from '../src/auth/google.js';
import {
  MemoryPlayerRepo,
  MemoryUserRepo,
  deleteAccount,
  exportAccount,
  freshPlayer,
  loginWithGoogle,
  mergePlayers,
  userIdForGoogle,
} from '../src/auth/accounts.js';
import { registerAuthRoutes, resolvePlayerId } from '../src/auth/routes.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
let privateKey: KeyObject;
let jwk: Jwk;

beforeAll(() => {
  initSessionSecret({ SESSION_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv);
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256', use: 'sig' };
});

const keys = async () => [jwk];

function googleToken(claims: Record<string, unknown>, kid = 'k1'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: now + 3600, iat: now, ...claims }),
  ).toString('base64url');
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('sesión', () => {
  it('ida y vuelta', () => {
    const s = newSession('g_1', 'p1');
    expect(decodeSession(encodeSession(s))).toEqual(s);
  });
  it('rechaza firma manipulada', () => {
    const v = encodeSession(newSession('g_1', 'p1'));
    const forged = Buffer.from(JSON.stringify({ uid: 'g_2', pid: 'p2', exp: 9e9 })).toString('base64url');
    expect(decodeSession(`${forged}.${v.split('.')[1]}`)).toBeNull();
    expect(decodeSession('basura')).toBeNull();
  });
  it('sesión caducada = invitado', () => {
    const s = newSession('g_1', 'p1', 1000);
    expect(decodeSession(encodeSession(s), s.exp + 1)).toBeNull();
  });
  it('sin SESSION_SECRET en producción el login se desactiva (no se cae el server)', () => {
    const warns: string[] = [];
    expect(initSessionSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv, (m) => warns.push(m))).toBe(false);
    expect(warns[0]).toContain('DESACTIVADO');
    expect(initSessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv, () => undefined)).toBe(true);
    // Volvemos al secreto fijo del resto de tests.
    expect(initSessionSecret({ SESSION_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv)).toBe(true);
  });
  it('lee cookies', () => {
    expect(readCookie('a=1; guinote_sid=xyz.abc; b=2', 'guinote_sid')).toBe('xyz.abc');
    expect(readCookie(undefined, 'a')).toBeNull();
  });
});

describe('ID token de Google', () => {
  it('acepta un token válido', async () => {
    const id = await verifyGoogleIdToken(googleToken({ sub: '42', email: 'a@b.c', email_verified: true, name: 'Ana Pérez', given_name: 'Ana' }), CLIENT_ID, keys);
    expect(id).toMatchObject({ sub: '42', email: 'a@b.c', name: 'Ana Pérez', givenName: 'Ana' });
  });
  it('rechaza otra audiencia, caducado, clave desconocida y firma falsa', async () => {
    await expect(verifyGoogleIdToken(googleToken({ sub: '1', aud: 'otro' }), CLIENT_ID, keys)).rejects.toThrow(GoogleTokenError);
    await expect(verifyGoogleIdToken(googleToken({ sub: '1', exp: 10 }), CLIENT_ID, keys)).rejects.toThrow('caducado');
    await expect(verifyGoogleIdToken(googleToken({ sub: '1' }, 'k9'), CLIENT_ID, keys)).rejects.toThrow('clave');
    const t = googleToken({ sub: '1' }).split('.');
    const evil = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: 9e9, sub: 'admin' })).toString('base64url');
    await expect(verifyGoogleIdToken(`${t[0]}.${evil}.${t[2]}`, CLIENT_ID, keys)).rejects.toThrow('firma');
    await expect(verifyGoogleIdToken(googleToken({ sub: '1', iss: 'evil.com' }), CLIENT_ID, keys)).rejects.toThrow('emisor');
  });
});

describe('cuentas', () => {
  it('primer login: el player del dispositivo pasa a ser el de la cuenta', async () => {
    const users = new MemoryUserRepo();
    const players = new MemoryPlayerRepo();
    await players.put({ ...freshPlayer('dev1'), rating: 1080, games: 7, wins: 5, losses: 2 });
    const r = await loginWithGoogle(users, players, { sub: 'S', name: 'Jose', devicePlayerId: 'dev1' });
    expect(r).toMatchObject({ playerId: 'dev1', created: true, merged: false });
    expect((await players.get('dev1'))).toMatchObject({ rating: 1080, games: 7, userId: 'g_S', name: 'Jose' });
    expect((await users.get('g_S'))?.linkedPlayerIds).toEqual(['dev1']);
  });

  it('sin player en el dispositivo crea uno nuevo', async () => {
    const r = await loginWithGoogle(new MemoryUserRepo(), new MemoryPlayerRepo(), { sub: 'S', devicePlayerId: null });
    expect(r.created).toBe(true);
    expect(r.playerId).toMatch(/[0-9a-f-]{36}/);
  });

  it('otro dispositivo: fusiona partidas en el principal y se queda el rating del más jugado', async () => {
    const users = new MemoryUserRepo();
    const players = new MemoryPlayerRepo();
    await players.put({ ...freshPlayer('pc'), rating: 1040, games: 3, wins: 2, losses: 1 });
    await players.put({ ...freshPlayer('movil'), rating: 960, games: 10, wins: 4, losses: 6 });
    await loginWithGoogle(users, players, { sub: 'S', devicePlayerId: 'pc' });
    const r = await loginWithGoogle(users, players, { sub: 'S', devicePlayerId: 'movil' });
    expect(r).toMatchObject({ playerId: 'pc', created: false, merged: true });
    expect(await players.get('pc')).toMatchObject({ rating: 960, games: 13, wins: 6, losses: 7 });
    expect(await players.get('movil')).toMatchObject({ mergedInto: 'pc', userId: 'g_S' });
    // Volver a entrar desde el móvil no fusiona dos veces.
    const again = await loginWithGoogle(users, players, { sub: 'S', devicePlayerId: 'movil' });
    expect(again.merged).toBe(false);
    expect((await players.get('pc'))?.games).toBe(13);
  });

  it('no toca el player de otra cuenta (dispositivo compartido)', async () => {
    const users = new MemoryUserRepo();
    const players = new MemoryPlayerRepo();
    await players.put({ ...freshPlayer('compartido'), games: 4 });
    await loginWithGoogle(users, players, { sub: 'ANA', devicePlayerId: 'compartido' });
    const r = await loginWithGoogle(users, players, { sub: 'BEA', devicePlayerId: 'compartido' });
    expect(r.playerId).not.toBe('compartido');
    expect((await players.get('compartido'))?.userId).toBe('g_ANA');
  });

  it('mergePlayers a igualdad de partidas se queda el rating del principal', () => {
    const a = { ...freshPlayer('a'), rating: 1100, games: 2, wins: 2 };
    const b = { ...freshPlayer('b'), rating: 900, games: 2, losses: 2 };
    expect(mergePlayers(a, b)).toMatchObject({ id: 'a', rating: 1100, games: 4, wins: 2, losses: 2 });
  });

  it('exportar y borrar la cuenta (RGPD)', async () => {
    const users = new MemoryUserRepo();
    const players = new MemoryPlayerRepo();
    await players.put({ ...freshPlayer('pc'), games: 1 });
    await players.put({ ...freshPlayer('movil'), games: 1 });
    await loginWithGoogle(users, players, { sub: 'S', email: 'j@x.es', devicePlayerId: 'pc' });
    await loginWithGoogle(users, players, { sub: 'S', devicePlayerId: 'movil' });
    const data = await exportAccount(users, players, userIdForGoogle('S'));
    expect(data?.user.email).toBe('j@x.es');
    expect(data?.players.map((p) => p.id).sort()).toEqual(['movil', 'pc']);
    expect(await deleteAccount(users, players, 'g_S')).toBe(true);
    expect(await users.get('g_S')).toBeNull();
    expect(players.map.size).toBe(0);
  });
});

describe('endpoints', () => {
  async function makeApp(clientId: string | null = CLIENT_ID) {
    const users = new MemoryUserRepo();
    const players = new MemoryPlayerRepo();
    const app = Fastify();
    await registerAuthRoutes(app, { googleClientId: clientId, keys, repos: () => ({ users, players }) });
    return { app, users, players };
  }
  function cookiesOf(res: { headers: Record<string, unknown> }): Record<string, string> {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    const out: Record<string, string> = {};
    for (const c of list) {
      const [kv] = String(c).split(';');
      const eq = kv!.indexOf('=');
      out[kv!.slice(0, eq)] = kv!.slice(eq + 1);
    }
    return out;
  }

  it('config sin client id = login desactivado', async () => {
    const { app } = await makeApp(null);
    expect((await app.inject({ url: '/api/config' })).json()).toEqual({ googleClientId: null });
    expect((await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: 'x' } })).statusCode).toBe(503);
  });

  it('login → /api/me → WS juega con el player de la cuenta → logout', async () => {
    const { app, players } = await makeApp();
    await players.put({ ...freshPlayer('anon'), games: 2, wins: 1, losses: 1 });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { cookie: 'guinote_pid=anon' },
      payload: { credential: googleToken({ sub: '7', name: 'Jose', given_name: 'Jose', email: 'j@x.es', email_verified: true }) },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { name: 'Jose', email: 'j@x.es' }, givenName: 'Jose', created: true });
    const c = cookiesOf(login);
    expect(c.guinote_pid).toBe('anon');
    const cookie = `${SESSION_COOKIE}=${c[SESSION_COOKIE]}; guinote_pid=anon`;

    const me = await app.inject({ url: '/api/me', headers: { cookie } });
    expect(me.json()).toEqual({ user: { name: 'Jose', email: 'j@x.es' }, player: { games: 2, wins: 1, losses: 1 } });

    // WS / POST rooms: la sesión manda aunque el ?pid o la cookie digan otra cosa.
    expect(resolvePlayerId({ headers: { cookie: `${SESSION_COOKIE}=${c[SESSION_COOKIE]}; guinote_pid=otro` } }, 'falso')).toBe('anon');
    // Sin sesión, como siempre: ?pid o cookie anónima.
    expect(resolvePlayerId({ headers: { cookie: 'guinote_pid=suelto' } })).toBe('suelto');
    expect(resolvePlayerId({ headers: {} }, 'q')).toBe('q');
    expect(resolvePlayerId({ headers: {} })).toBeNull();

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(cookiesOf(out)).toEqual({ guinote_sid: '', guinote_pid: '' });
  });

  it('token rechazado = 401; sin sesión /api/me es invitado', async () => {
    const { app } = await makeApp();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: googleToken({ sub: '1', aud: 'otro' }) } });
    expect(bad.statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me' })).json()).toEqual({ user: null });
  });

  it('borrar cuenta: borra datos y cookies; la sesión vieja ya no vale', async () => {
    const { app, users } = await makeApp();
    const login = await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: googleToken({ sub: '9' }) } });
    const cookie = `${SESSION_COOKIE}=${cookiesOf(login)[SESSION_COOKIE]}`;
    const data = await app.inject({ url: '/api/me/data', headers: { cookie } });
    expect(data.headers['content-disposition']).toContain('attachment');
    expect(data.json().user.userId).toBe('g_9');
    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(users.map.size).toBe(0);
    expect((await app.inject({ url: '/api/me', headers: { cookie } })).json()).toEqual({ user: null });
    expect((await app.inject({ method: 'DELETE', url: '/api/me' })).statusCode).toBe(401);
  });
});
