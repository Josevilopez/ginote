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
import { recentFor, resultRepo, type ResultRepo } from '../results.js';
import { checkPlaceChange, municipioName, municipiosOf, viewPlace } from '../places.js';
import { PAIR_MIN_GAMES, pairName, pairRepo, topPairEntries, type PairRepo } from '../pairs.js';
import {
  CosmosRankingSource,
  MemoryRankingSource,
  activeSince,
  cleanPublicName,
  eligibility,
  newTag,
  topEntries,
  weekEligibility,
  type Period,
  type RankingSource,
  type Scope,
} from '../ranking.js';
import { divisionFor, isOffensiveName, provinceName, rolloverSeason, seasonEndLabel, seasonId, seasonName, weekId } from '@guinote/protocol';
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
import { forgetUser } from '../friends.js';
import { pushRepo } from '../push.js';
import { leavePena, penaRepo } from '../penas.js';
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
  results?: () => ResultRepo;
  ranking?: () => RankingSource;
  pairs?: () => PairRepo;
}

export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions = {}): Promise<void> {
  const clientId = opts.googleClientId !== undefined ? opts.googleClientId : process.env.GOOGLE_CLIENT_ID || null;
  const keys = opts.keys ?? googleKeys;
  const repos = opts.repos ?? authRepos;
  const results = opts.results ?? resultRepo;
  const pairs = opts.pairs ?? pairRepo;
  const ranking =
    opts.ranking ??
    (() => {
      const h = getCosmosHandles();
      return h ? new CosmosRankingSource(h.players) : new MemoryRankingSource(() => memoryPlayers.map.values());
    });

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
    let p = await players.get(user.primaryPlayerId).catch(() => null);
    // S4-09: si cambió la temporada desde tu última visita, se aplica ya
    // (insignia + nivel a medio camino de 1000).
    if (p) {
      const roll = rolloverSeason(p);
      if (roll) {
        p = { ...p, ...roll };
        await players.put(p).catch(() => undefined);
      }
    }
    const current = seasonId();
    return {
      // S4-09: temporada actual e insignias de las pasadas.
      season: {
        id: current,
        name: seasonName(current),
        ends: seasonEndLabel(current),
        badges: (p?.seasonBadges ?? []).map((b) => ({ season: b.season, name: seasonName(b.season), division: b.division })),
      },
      // S4-03: de dónde eres.
      place: viewPlace(p?.place, p?.placeChangedAt),
      user: { name: user.name ?? null, email: user.email ?? null, since: user.createdAt },
      // S5-05: torneos ganados.
      trophies: (user as { trophies?: { torneoId: string; name: string; at: string }[] }).trophies ?? [],
      player: p
        ? {
            games: p.games,
            wins: p.wins,
            losses: p.losses,
            streak: p.streak ?? 0,
            bestStreak: p.bestStreak ?? 0,
            rating: Math.round(p.rating),
            publicName: p.publicName ?? null,
            tag: p.tag ?? null,
          }
        : null,
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

  // S4-04: tu nombre público (el nombre en la mesa) para el ranking.
  app.put('/api/me/name', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const raw = (req.body as { name?: unknown } | undefined)?.name;
    const name = cleanPublicName(raw);
    if (!name) {
      const offensive = typeof raw === 'string' && isOffensiveName(raw);
      return reply.code(400).send({ error: offensive ? 'Ese nombre no está permitido' : 'Nombre no válido' });
    }
    const { users, players } = repos();
    const user = await users.get(s.uid);
    if (!user) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    const p = await players.get(user.primaryPlayerId);
    if (!p) return reply.code(404).send({ error: 'Jugador no encontrado' });
    // S4-08: nombre + etiqueta únicos. Se conserva tu etiqueta salvo que
    // otro jugador ya sea "ese nombre#esa etiqueta".
    let tag = p.tag ?? newTag();
    for (let i = 0; i < 20 && (await players.nameTaken(name, tag, p.id)); i++) tag = newTag();
    if (p.publicName !== name || p.tag !== tag) await players.put({ ...p, publicName: name, tag });
    return { publicName: name, tag };
  });

  // S4-04: ranking. `scope` = es | prov | mun (los dos últimos, el tuyo).
  app.get<{ Querystring: { scope?: string; period?: string } }>('/api/ranking', async (req) => {
    const kind = req.query.scope === 'prov' || req.query.scope === 'mun' ? req.query.scope : 'es';
    // S4-06: `period=week` → clasificación de esta semana. S4-05: `period=pairs` → parejas.
    const isPairs = req.query.period === 'pairs';
    const period: Period = req.query.period === 'week' ? 'week' : 'all';
    const sess = sessionOf(req);
    const { users, players } = repos();
    const user = sess ? await users.get(sess.uid).catch(() => null) : null;
    const me = user ? await players.get(user.primaryPlayerId).catch(() => null) : null;

    let scope: Scope = { kind: 'es' };
    let label = 'España';
    if (kind === 'prov') {
      if (!me?.place?.province) return { scope: kind, period, label: null, needsPlace: true, entries: [], me: null };
      scope = { kind: 'prov', province: me.place.province };
      label = provinceName(me.place.province) ?? '';
    } else if (kind === 'mun') {
      if (!me?.place?.municipio) return { scope: kind, period, label: null, needsPlace: true, entries: [], me: null };
      scope = { kind: 'mun', municipio: me.place.municipio };
      label = municipioName(me.place.municipio) ?? '';
    }

    if (isPairs) {
      try {
        const repo = pairs();
        const pid = me?.id ?? null;
        const entries = await topPairEntries(repo, scope, activeSince(), pid);
        let mine = null;
        if (user && pid) {
          const mineList = (await repo.forPlayer(pid)).sort((a, b) => b.rating - a.rating);
          const best = mineList[0];
          if (!best) mine = { eligible: false, reason: 'no_pair', gamesLeft: null };
          else if (best.games < PAIR_MIN_GAMES) mine = { eligible: false, reason: 'pair_games', gamesLeft: PAIR_MIN_GAMES - best.games, pairName: pairName(best) };
          else if (best.lastPlayedAt < activeSince()) mine = { eligible: false, reason: 'inactive', gamesLeft: null, pairName: pairName(best) };
          else if ((scope.kind === 'prov' && best.place.province !== scope.province) || (scope.kind === 'mun' && best.place.municipio !== scope.municipio)) {
            mine = { eligible: false, reason: 'pair_place', gamesLeft: null, pairName: pairName(best) };
          } else {
            const inTop = entries.find((e) => e.you);
            const pos = inTop?.pos ?? (await repo.countAbove(scope, activeSince(), best.rating)) + 1;
            mine = { eligible: true, pos, points: Math.round(best.rating), rating: Math.round(best.rating), division: null, pairName: pairName(best) };
          }
        }
        return { scope: kind, period: 'pairs', label, needsPlace: false, entries, me: mine };
      } catch (err) {
        req.log.error({ err }, '[ranking] parejas: no se pudo leer');
        return { scope: kind, period: 'pairs', label, needsPlace: false, entries: [], me: null, error: 'No se pudo cargar el ranking' };
      }
    }

    const source = ranking();
    try {
      const entries = await topEntries(source, scope, me?.id ?? null, new Date(), period);
      let mine = null;
      if (user) {
        const division = me ? divisionFor(me.rating, me.games) : null;
        const inTop = entries.find((e) => e.you);
        if (period === 'week') {
          const week = weekId();
          const el = weekEligibility(me, week);
          if (el.ok) {
            const pts = Math.round(me!.weekPoints ?? 0);
            const pos = inTop?.pos ?? (await source.countAboveWeek(scope, week, me!.weekPoints ?? 0)) + 1;
            mine = { eligible: true, pos, points: pts, rating: Math.round(me!.rating), division };
          } else {
            mine = { eligible: false, reason: el.reason, gamesLeft: el.gamesLeft ?? null };
          }
        } else {
          const el = eligibility(me);
          if (el.ok) {
            const pos = inTop?.pos ?? (await source.countAbove(scope, activeSince(), me!.rating)) + 1;
            mine = { eligible: true, pos, points: Math.round(me!.rating), rating: Math.round(me!.rating), division };
          } else {
            mine = { eligible: false, reason: el.reason, gamesLeft: el.gamesLeft ?? null };
          }
        }
      }
      return { scope: kind, period, label, needsPlace: false, entries, me: mine };
    } catch (err) {
      req.log.error({ err }, '[ranking] no se pudo leer');
      return { scope: kind, period, label, needsPlace: false, entries: [], me: null, error: 'No se pudo cargar el ranking' };
    }
  });

  // S4-03: municipios de una provincia (lista del INE), para el buscador del perfil.
  app.get<{ Params: { prov: string } }>('/api/places/:prov', async (req, reply) => {
    const list = municipiosOf(req.params.prov);
    if (!list) return reply.code(404).send({ error: 'Provincia no válida' });
    reply.header('Cache-Control', 'public, max-age=86400');
    return { municipios: list };
  });

  // S4-03: guardar de dónde eres (una vez cada 30 días; la primera, libre).
  app.put('/api/me/place', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const { users, players } = repos();
    const user = await users.get(s.uid);
    if (!user) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    const p = await players.get(user.primaryPlayerId);
    if (!p) return reply.code(404).send({ error: 'Jugador no encontrado' });
    const body = (req.body ?? {}) as { province?: unknown; municipio?: unknown };
    // Sin cambios de verdad → no gasta el cambio del mes.
    const same =
      (p.place?.province ?? null) === (body.province || null) && (p.place?.municipio ?? null) === (body.municipio || null);
    if (same) return { place: viewPlace(p.place, p.placeChangedAt) };
    const check = checkPlaceChange(body, p.placeChangedAt);
    if (!check.ok) return reply.code(409).send({ error: check.error, place: viewPlace(p.place, p.placeChangedAt) });
    const changedAt = new Date().toISOString();
    await players.put({ ...p, place: check.place, placeChangedAt: changedAt });
    return { place: viewPlace(check.place, changedAt) };
  });

  // S4-01: tus últimas partidas (de la cuenta y de los dispositivos fusionados).
  app.get('/api/me/results', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const { users } = repos();
    const user = await users.get(s.uid).catch(() => null);
    if (!user) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    try {
      const list = await recentFor([user.primaryPlayerId, ...user.linkedPlayerIds], 20, results());
      return {
        results: list.map(({ at, kind, won, abandoned, ratingBefore, ratingAfter, mate, rivals }) => ({
          at,
          kind,
          won,
          abandoned: abandoned === true,
          delta: ratingAfter - ratingBefore,
          mate,
          rivals,
        })),
      };
    } catch (err) {
      req.log.error({ err }, '[historial] no se pudo leer');
      return { results: [] };
    }
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
    const history = await recentFor([data.user.primaryPlayerId, ...data.user.linkedPlayerIds], 10_000, results()).catch(() => []);
    const myPairs = (await Promise.all([...new Set([data.user.primaryPlayerId, ...data.user.linkedPlayerIds])].map((id) => pairs().forPlayer(id).catch(() => [])))).flat();
    reply.header('Content-Disposition', 'attachment; filename="guinote-mis-datos.json"');
    const pushDevices = await pushRepo(() => getCosmosHandles()?.pushSubs ?? null)
      .list(s.uid)
      .catch(() => []);
    return { ...data, results: history, pairs: myPairs, pushDevices };
  });

  app.delete('/api/me', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const { users, players } = repos();
    const user = await users.get(s.uid);
    if (user) {
      for (const id of new Set([user.primaryPlayerId, ...user.linkedPlayerIds])) {
        await results().removeAll(id).catch((err) => req.log.error({ err }, '[historial] no se pudo borrar'));
        await pairs().removePlayer(id).catch((err) => req.log.error({ err }, '[parejas] no se pudo borrar'));
      }
    }
    // S5-01: sale de las listas de amigos de los demás.
    await pushRepo(() => getCosmosHandles()?.pushSubs ?? null)
      .removeAll(s.uid)
      .catch((err) => req.log.error({ err }, '[push] no se pudo borrar'));
    await leavePena({ users, players, penas: penaRepo(() => getCosmosHandles()?.penas ?? null) }, s.uid).catch((err) =>
      req.log.error({ err }, '[peñas] no se pudo salir'),
    );
    await forgetUser(users, s.uid).catch((err) => req.log.error({ err }, '[amigos] no se pudo limpiar'));
    await deleteAccount(users, players, s.uid);
    clearCookies(req, reply);
    req.log.info(`[auth] cuenta borrada ${s.uid}`);
    return { ok: true };
  });
}
