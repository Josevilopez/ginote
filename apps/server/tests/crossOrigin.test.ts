import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { encodeSession, initSessionSecret, newSession, SESSION_COOKIE } from '../src/auth/session.js';
import { MemoryPlayerRepo, MemoryUserRepo, freshPlayer, type User } from '../src/auth/accounts.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import {
  cookieDomainFor,
  originAllowed,
  readCrossOriginConfig,
  requestHost,
  setCrossOriginConfig,
} from '../src/crossOrigin.js';

beforeAll(() => {
  initSessionSecret({ SESSION_SECRET: 'z'.repeat(40) } as NodeJS.ProcessEnv);
});
afterEach(() => setCrossOriginConfig(readCrossOriginConfig({} as NodeJS.ProcessEnv)));

const PROD = readCrossOriginConfig({
  ALLOWED_ORIGINS: 'https://guinoteonline.es, https://www.guinoteonline.es/ ,basura',
  COOKIE_DOMAIN: 'guinoteonline.es',
  SERVE_WEB: 'false',
} as NodeJS.ProcessEnv);

describe('configuración', () => {
  it('lee la lista, el dominio y SERVE_WEB', () => {
    expect(PROD).toEqual({
      allowedOrigins: ['https://guinoteonline.es', 'https://www.guinoteonline.es'],
      cookieDomain: '.guinoteonline.es',
      serveWeb: false,
    });
    expect(readCrossOriginConfig({} as NodeJS.ProcessEnv)).toEqual({ allowedOrigins: [], cookieDomain: null, serveWeb: true });
  });

  it('orígenes permitidos', () => {
    expect(originAllowed('https://guinoteonline.es', PROD, 'api.guinoteonline.es')).toBe(true);
    expect(originAllowed('https://GUINOTEONLINE.es/', PROD, 'api.guinoteonline.es')).toBe(true);
    expect(originAllowed('https://malo.com', PROD, 'api.guinoteonline.es')).toBe(false);
    expect(originAllowed('https://guinoteonline.es.malo.com', PROD, 'api.guinoteonline.es')).toBe(false);
    // Sin cabecera (apps, curl) y la web servida por el propio contenedor.
    expect(originAllowed(undefined, PROD, 'api.guinoteonline.es')).toBe(true);
    expect(originAllowed('https://ginote-server.azurecontainerapps.io', PROD, 'ginote-server.azurecontainerapps.io')).toBe(true);
    // Sin lista: como hasta ahora.
    expect(originAllowed('https://cualquiera.com', readCrossOriginConfig({} as NodeJS.ProcessEnv), 'x')).toBe(true);
  });

  it('dominio de las cookies solo si la petición llega por ese dominio', () => {
    expect(cookieDomainFor('guinoteonline.es', PROD)).toBe('.guinoteonline.es');
    expect(cookieDomainFor('api.guinoteonline.es', PROD)).toBe('.guinoteonline.es');
    expect(cookieDomainFor('www.guinoteonline.es', PROD)).toBe('.guinoteonline.es');
    expect(cookieDomainFor('ginote-server.azurecontainerapps.io', PROD)).toBeNull();
    expect(cookieDomainFor('noguinoteonline.es', PROD)).toBeNull();
    expect(requestHost({ host: 'API.guinoteonline.es:443' })).toBe('api.guinoteonline.es');
    expect(requestHost({ host: 'interno', 'x-forwarded-host': 'guinoteonline.es' })).toBe('guinoteonline.es');
  });
});

describe('migración de cookies en /api/me', () => {
  async function makeApp() {
    const users = new MemoryUserRepo();
    const players = new MemoryPlayerRepo();
    const now = new Date().toISOString();
    const u: User = { id: 'g_1', userId: 'g_1', provider: 'google', sub: '1', primaryPlayerId: 'p_1', linkedPlayerIds: ['p_1'], createdAt: now, lastLoginAt: now };
    await users.put(u);
    await players.put({ ...freshPlayer('p_1'), userId: 'g_1', publicName: 'Josevi', tag: '1234' });
    const app = Fastify();
    await registerAuthRoutes(app, { googleClientId: null, repos: () => ({ users, players }) });
    return app;
  }
  const setCookies = (res: { headers: Record<string, unknown> }) => {
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
  };
  // Después de `initSessionSecret` (beforeAll), no al cargar el fichero.
  let sid = '';
  let cookie = '';
  beforeAll(() => {
    sid = encodeSession(newSession('g_1', 'p_1'));
    cookie = `${SESSION_COOKIE}=${sid}; guinote_pid=11111111-2222-3333-4444-555555555555`;
  });

  it('sin COOKIE_DOMAIN no toca nada', async () => {
    const app = await makeApp();
    const res = await app.inject({ url: '/api/me', headers: { cookie, host: 'guinoteonline.es' } });
    expect(res.json().user).toBeTruthy();
    expect(setCookies(res)).toEqual([]);
  });

  it('con COOKIE_DOMAIN reescribe sesión y jugador con el dominio y borra las antiguas', async () => {
    setCrossOriginConfig(PROD);
    const app = await makeApp();
    const res = await app.inject({ url: '/api/me', headers: { cookie, host: 'guinoteonline.es', 'x-forwarded-proto': 'https' } });
    expect(res.json().user).toBeTruthy();
    const sc = setCookies(res);
    expect(sc).toHaveLength(4);
    expect(sc.filter((c) => c.includes('Max-Age=0') && !c.includes('Domain='))).toHaveLength(2);
    const sess = sc.find((c) => c.startsWith(`${SESSION_COOKIE}=${sid}`))!;
    expect(sess).toContain('Domain=.guinoteonline.es');
    expect(sess).toContain('Secure');
    expect(Number(/Max-Age=(\d+)/.exec(sess)![1])).toBeGreaterThan(0);
    expect(sc.some((c) => c.startsWith('guinote_pid=11111111') && c.includes('Domain=.guinoteonline.es'))).toBe(true);
  });

  it('invitado: también se lleva su cookie de jugador; por otro host, nada', async () => {
    setCrossOriginConfig(PROD);
    const app = await makeApp();
    const guest = await app.inject({ url: '/api/me', headers: { cookie: 'guinote_pid=abc-123', host: 'guinoteonline.es' } });
    expect(guest.json()).toEqual({ user: null });
    expect(setCookies(guest).some((c) => c.startsWith('guinote_pid=abc-123') && c.includes('Domain='))).toBe(true);
    const other = await app.inject({ url: '/api/me', headers: { cookie, host: 'ginote-server.azurecontainerapps.io' } });
    expect(setCookies(other)).toEqual([]);
  });

  it('logout borra las dos versiones', async () => {
    setCrossOriginConfig(PROD);
    const app = await makeApp();
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, host: 'api.guinoteonline.es' } });
    const sc = setCookies(out);
    expect(sc).toHaveLength(4);
    expect(sc.every((c) => c.includes('Max-Age=0'))).toBe(true);
    expect(sc.filter((c) => c.includes('Domain=.guinoteonline.es'))).toHaveLength(2);
  });
});
