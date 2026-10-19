/**
 * S3-01: endpoints de cuenta.
 *
 *  GET    /api/config        → { googleClientId } (null = login desactivado)
 *  GET    /api/me            → { user, player } o { user: null }
 *  POST   /api/auth/google   → { credential } (ID token de Google) → entra
 *  POST   /api/auth/logout   → sale (borra sesión y player del dispositivo)
 *  GET    /api/me/data       → descarga JSON con todos tus datos (RGPD)
 *  DELETE /api/me            → borra la cuenta y sus players (RGPD)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getCosmosHandles } from '../globalHandles.js';
import { PLAYER_COOKIE, PLAYER_COOKIE_MAX_AGE } from '../players.js';
import {
  CosmosPlayerRepo,
  CosmosUserRepo,
  MemoryPlayerRepo,
  MemoryUserRepo,
  deleteAccount,
  exportAccount,
  loginWithGoogle,
  type PlayerRepo,
  type UserRepo,
} from './accounts.js';
import { GoogleTokenError, verifyGoogleIdToken, type KeySource, googleKeys } from './google.js';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  cookieString,
  decodeSession,
  encodeSession,
  newSession,
  readCookie,
  type Session,
} from './session.js';

const memoryUsers = new MemoryUserRepo();
const memoryPlayers = new MemoryPlayerRepo();

export interface AuthRepos {
  users: UserRepo;
  players: PlayerRepo;
}

/** Cosmos si está activo (y existe el contenedor `users`); si no, memoria. */
export function authRepos(): AuthRepos {
  const h = getCosmosHandles();
  if (h) return { users: new CosmosUserRepo(h.users), players: new CosmosPlayerRepo(h.players) };
  return { users: memoryUsers, players: memoryPlayers };
}

/** Sesión válida del request (cookie `guinote_sid`), o null. */
export function sessionOf(req: { headers: { cookie?: string | undefined } }): Session | null {
  return decodeSession(readCookie(req.headers.cookie, SESSION_COOKIE));
}

/**
 * Player con el que juega este request: el de la cuenta si hay sesión;
 * si no, el anónimo de la cookie `guinote_pid` (o `?pid=`), o null.
 */
export function resolvePlayerId(
  req: { headers: { cookie?: string | undefined } },
  pidFromQuery: string | null = null,
): string | null {
  const s = sessionOf(req);
  if (s) return s.pid;
  return pidFromQuery ?? readCookie(req.headers.cookie, PLAYER_COOKIE);
}

function isHttps(req: FastifyRequest): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return proto === 'https';
}

function clearCookies(req: FastifyRequest, reply: FastifyReply): void {
  const secure = isHttps(req);
  reply.header('Set-Cookie', [
    cookieString(SESSION_COOKIE, '', 0, secure),
    cookieString(PLAYER_COOKIE, '', 0, secure),
  ]);
}

export interface AuthRouteOptions {
  /** Para tests. Por defecto `process.env.GOOGLE_CLIENT_ID`. */
  googleClientId?: string | null;
  keys?: KeySource;
  repos?: () => AuthRepos;
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions = {}): Promise<void> {
  const clientId = opts.googleClientId !== undefined ? opts.googleClientId : process.env.GOOGLE_CLIENT_ID || null;
  const keys = opts.keys ?? googleKeys;
  const repos = opts.repos ?? authRepos;

  app.get('/api/config', async () => ({ googleClientId: clientId }));

  app.get('/api/me', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return { user: null };
    const { users, players } = repos();
    let user;
    try {
      user = await users.get(s.uid);
    } catch (err) {
      // Base de datos caída o sin permisos: la portada sigue funcionando
      // (como invitado) en vez de recibir un 500.
      const e = err as { code?: number | string; message?: string };
      req.log.error({ err }, `[auth] /api/me no pudo leer la cuenta (code=${e.code ?? '?'})`);
      return { user: null };
    }
    if (!user) {
      // Cuenta borrada desde otro dispositivo.
      clearCookies(req, reply);
      return { user: null };
    }
    const p = await players.get(user.primaryPlayerId).catch(() => null);
    return {
      user: { name: user.name ?? null, email: user.email ?? null },
      player: p ? { games: p.games, wins: p.wins, losses: p.losses } : null,
    };
  });

  app.post('/api/auth/google', async (req, reply) => {
    if (!clientId) return reply.code(503).send({ error: 'Login con Google no configurado' });
    const credential = (req.body as { credential?: unknown } | undefined)?.credential;
    if (typeof credential !== 'string' || credential.length > 4096) {
      return reply.code(400).send({ error: 'credential requerido' });
    }
    let id;
    try {
      id = await verifyGoogleIdToken(credential, clientId, keys);
    } catch (err) {
      if (err instanceof GoogleTokenError) {
        req.log.warn(`[auth] token de Google rechazado: ${err.message}`);
        return reply.code(401).send({ error: 'No se pudo verificar tu cuenta de Google' });
      }
      throw err;
    }
    const { users, players } = repos();
    let result;
    try {
      result = await loginWithGoogle(users, players, {
        sub: id.sub,
        ...(id.email && id.emailVerified !== false ? { email: id.email } : {}),
        ...(id.name ? { name: id.name } : {}),
        devicePlayerId: readCookie(req.headers.cookie, PLAYER_COOKIE),
      });
    } catch (err) {
      // Casi siempre Cosmos: falta el contenedor `users` (404), la
      // identidad no tiene permiso de datos (403) o credenciales mal.
      const e = err as { code?: number | string; message?: string };
      req.log.error({ err }, `[auth] no se pudo guardar la cuenta en la base de datos (code=${e.code ?? '?'}): ${e.message ?? ''}`);
      return reply.code(500).send({ error: 'No se pudo guardar tu cuenta' });
    }
    const secure = isHttps(req);
    reply.header('Set-Cookie', [
      cookieString(SESSION_COOKIE, encodeSession(newSession(result.user.userId, result.playerId)), SESSION_MAX_AGE_S, secure),
      cookieString(PLAYER_COOKIE, result.playerId, PLAYER_COOKIE_MAX_AGE, secure),
    ]);
    req.log.info(`[auth] login ${result.user.userId} created=${result.created} merged=${result.merged}`);
    return {
      user: { name: result.user.name ?? null, email: result.user.email ?? null },
      givenName: id.givenName ?? null,
      created: result.created,
      merged: result.merged,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    clearCookies(req, reply);
    return { ok: true };
  });

  app.get('/api/me/data', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const { users, players } = repos();
    const data = await exportAccount(users, players, s.uid);
    if (!data) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    reply.header('Content-Disposition', 'attachment; filename="guinote-mis-datos.json"');
    return data;
  });

  app.delete('/api/me', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const { users, players } = repos();
    await deleteAccount(users, players, s.uid);
    clearCookies(req, reply);
    req.log.info(`[auth] cuenta borrada ${s.uid}`);
    return { ok: true };
  });
}
