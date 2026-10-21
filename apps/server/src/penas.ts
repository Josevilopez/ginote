/**
 * S5-03: peñas. Un grupo de gente (la cuadrilla, el bar, el pueblo) con su
 * ranking interno y quién está conectado para montar partida.
 *
 * - Solo con cuenta. Cada persona está en **una** peña como mucho (así el
 *   reto entre peñas de S5-04 no tiene ambigüedades). Máx. MAX_MEMBERS.
 * - Contenedor `penas` (PK `/id`). En el doc del usuario: `penaId` y
 *   `penaInvites` (ids de peñas que te han invitado).
 * - Se entra con el enlace de la peña (`#pena-CODIGO`) o aceptando una
 *   invitación de un miembro. El creador puede expulsar; si se va, la peña
 *   pasa al miembro más antiguo (si no queda nadie, se borra).
 *
 *  GET  /api/penas/mine                  → { pena, invites }
 *  POST /api/penas            {name}     → crea (con tu pueblo, si lo tienes)
 *  GET  /api/penas/join/:code            → vista previa del enlace
 *  POST /api/penas/join/:code            → entrar
 *  POST /api/penas/invites/:id/accept|decline
 *  POST /api/penas/mine/invite/:userId   → invitar a un amigo
 *  POST /api/penas/mine/kick/:userId     → expulsar (solo el creador)
 *  POST /api/penas/mine/leave            → salir
 */
import type { Container } from '@azure/cosmos';
import type { FastifyInstance } from 'fastify';
import { divisionFor, isOffensiveName, rolloverSeason, searchKey, weekId, type Division } from '@guinote/protocol';
import type { LinkedPlayer, PlayerRepo, User, UserRepo } from './auth/accounts.js';
import type { Session } from './auth/session.js';
import { displayName, type FriendStatus, type Presence } from './friends.js';
import { municipioName } from './places.js';
import type { PushKind, PushMessage } from './push.js';
import { answerReto, proposeReto, retosOfPena, type RetoDeps, type RetoRepo, type RetoView } from './retos.js';

export const MAX_MEMBERS = 50;
export const MAX_PENA_INVITES = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PenaMember {
  userId: string;
  joinedAt: string;
}

export interface Pena {
  id: string;
  name: string;
  /** Código INE del pueblo, si lo tiene. */
  municipio: string | null;
  ownerId: string;
  members: PenaMember[];
  /** Código del enlace para entrar (`#pena-CODIGO`). */
  code: string;
  createdAt: string;
  /** S5-04: nombre sin tildes y en minúsculas, para buscar. */
  nameKey?: string;
}

export type PenaUser = User & { penaId?: string; penaInvites?: string[] };

export function newPenaCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  return out;
}

export function cleanPenaName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, 30);
  return s.length >= 3 && !isOffensiveName(s) ? s : null;
}

// ───────────── Repos ─────────────

export interface PenaRepo {
  get(id: string): Promise<Pena | null>;
  byCode(code: string): Promise<Pena | null>;
  put(p: Pena): Promise<void>;
  delete(id: string): Promise<void>;
  /** S5-04: peñas cuyo nombre contiene `key` (ya pasado por `searchKey`). */
  search(key: string, limit: number): Promise<Pena[]>;
}

export class MemoryPenaRepo implements PenaRepo {
  readonly map = new Map<string, Pena>();
  async get(id: string) {
    const p = this.map.get(id);
    return p ? structuredClone(p) : null;
  }
  async byCode(code: string) {
    for (const p of this.map.values()) if (p.code === code) return structuredClone(p);
    return null;
  }
  async put(p: Pena) {
    this.map.set(p.id, structuredClone(p));
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async search(key: string, limit: number) {
    return [...this.map.values()]
      .filter((p) => (p.nameKey ?? searchKey(p.name)).includes(key))
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }
}

export class CosmosPenaRepo implements PenaRepo {
  constructor(private readonly c: Container) {}
  async get(id: string) {
    try {
      const { resource } = await this.c.item(id, id).read<Pena>();
      return resource ? strip(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }
  async byCode(code: string) {
    const { resources } = await this.c.items
      .query<Pena>({ query: 'SELECT * FROM c WHERE c.code = @c', parameters: [{ name: '@c', value: code }] })
      .fetchAll();
    return resources[0] ? strip(resources[0]) : null;
  }
  async put(p: Pena) {
    await this.c.items.upsert({ ...p, nameKey: searchKey(p.name) });
  }
  async delete(id: string) {
    try {
      await this.c.item(id, id).delete();
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
  }
  async search(key: string, limit: number) {
    const { resources } = await this.c.items
      .query<Pena>({
        query: 'SELECT TOP @n * FROM c WHERE CONTAINS(c.nameKey, @k)',
        parameters: [
          { name: '@n', value: limit },
          { name: '@k', value: key },
        ],
      })
      .fetchAll();
    return resources.map(strip);
  }
}

function strip(p: Pena): Pena {
  return { id: p.id, name: p.name, municipio: p.municipio ?? null, ownerId: p.ownerId, members: p.members, code: p.code, createdAt: p.createdAt, nameKey: p.nameKey ?? searchKey(p.name) };
}

const memoryPenas = new MemoryPenaRepo();
let override: PenaRepo | null = null;
export function penaRepo(getContainer: () => Container | null): PenaRepo {
  if (override) return override;
  const c = getContainer();
  return c ? new CosmosPenaRepo(c) : memoryPenas;
}
export function setPenaRepo(r: PenaRepo | null): void {
  override = r;
}

// ───────────── Lógica ─────────────

export type Outcome<T = Pena> = { ok: true; value: T } | { ok: false; code: 400 | 403 | 404 | 409; error: string };
const fail = (code: 400 | 403 | 404 | 409, error: string) => ({ ok: false as const, code, error });

export interface PenaDeps {
  users: UserRepo;
  players: PlayerRepo;
  penas: PenaRepo;
}

async function codeFree(penas: PenaRepo): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const c = newPenaCode();
    if (!(await penas.byCode(c))) return c;
  }
  return newPenaCode() + newPenaCode().slice(0, 2);
}

export async function createPena(d: PenaDeps, meId: string, rawName: unknown, now: Date = new Date()): Promise<Outcome> {
  const name = cleanPenaName(rawName);
  if (!name) {
    const offensive = typeof rawName === 'string' && isOffensiveName(rawName);
    return fail(400, offensive ? 'Ese nombre no está permitido' : 'El nombre necesita al menos 3 letras');
  }
  const me = (await d.users.get(meId)) as PenaUser | null;
  if (!me) return fail(404, 'Cuenta no encontrada');
  if (me.penaId && (await d.penas.get(me.penaId))) return fail(409, 'Ya estás en una peña. Sal de ella para crear otra.');
  const player = await d.players.get(me.primaryPlayerId);
  const pena: Pena = {
    id: globalThis.crypto.randomUUID(),
    name,
    municipio: player?.place?.municipio ?? null,
    ownerId: meId,
    members: [{ userId: meId, joinedAt: now.toISOString() }],
    code: await codeFree(d.penas),
    createdAt: now.toISOString(),
    nameKey: searchKey(name),
  };
  await d.penas.put(pena);
  await d.users.put({ ...me, penaId: pena.id, penaInvites: [] } as User);
  return { ok: true, value: pena };
}

async function addMember(d: PenaDeps, me: PenaUser, pena: Pena, now: Date): Promise<Outcome> {
  if (pena.members.some((m) => m.userId === me.userId)) {
    if (me.penaId !== pena.id) await d.users.put({ ...me, penaId: pena.id } as User);
    return { ok: true, value: pena };
  }
  if (me.penaId && me.penaId !== pena.id && (await d.penas.get(me.penaId))) return fail(409, 'Ya estás en otra peña. Sal de ella para entrar en esta.');
  if (pena.members.length >= MAX_MEMBERS) return fail(409, `Esta peña ya tiene ${MAX_MEMBERS} miembros, el máximo.`);
  const next = { ...pena, members: [...pena.members, { userId: me.userId, joinedAt: now.toISOString() }] };
  await d.penas.put(next);
  await d.users.put({ ...me, penaId: pena.id, penaInvites: (me.penaInvites ?? []).filter((x) => x !== pena.id) } as User);
  return { ok: true, value: next };
}

export async function joinByCode(d: PenaDeps, meId: string, code: string, now: Date = new Date()): Promise<Outcome> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  if (!me) return fail(404, 'Cuenta no encontrada');
  const pena = await d.penas.byCode(code.trim().toUpperCase());
  if (!pena) return fail(404, 'Ese enlace de peña ya no vale');
  return addMember(d, me, pena, now);
}

export async function acceptInvite(d: PenaDeps, meId: string, penaId: string, now: Date = new Date()): Promise<Outcome> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  if (!me?.penaInvites?.includes(penaId)) return fail(404, 'Esa invitación ya no existe');
  const pena = await d.penas.get(penaId);
  if (!pena) {
    await d.users.put({ ...me, penaInvites: me.penaInvites.filter((x) => x !== penaId) } as User);
    return fail(404, 'Esa peña ya no existe');
  }
  return addMember(d, me, pena, now);
}

export async function declineInvite(d: PenaDeps, meId: string, penaId: string): Promise<void> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  if (me?.penaInvites?.includes(penaId)) await d.users.put({ ...me, penaInvites: me.penaInvites.filter((x) => x !== penaId) } as User);
}

/** Invita a otra cuenta (tiene que ser amigo tuyo o haberte pasado su código). */
export async function inviteToPena(d: PenaDeps, meId: string, otherId: string): Promise<Outcome<{ pena: Pena; other: PenaUser }>> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  const pena = me?.penaId ? await d.penas.get(me.penaId) : null;
  if (!me || !pena || !pena.members.some((m) => m.userId === meId)) return fail(404, 'No estás en ninguna peña');
  const other = (await d.users.get(otherId)) as PenaUser | null;
  if (!other) return fail(404, 'Esa cuenta ya no existe');
  if (pena.members.some((m) => m.userId === otherId)) return fail(409, 'Ya está en tu peña');
  if (other.penaId && (await d.penas.get(other.penaId))) return fail(409, 'Ya está en otra peña');
  if (pena.members.length >= MAX_MEMBERS) return fail(409, `La peña ya tiene ${MAX_MEMBERS} miembros, el máximo.`);
  const invites = (other.penaInvites ?? []).filter((x) => x !== pena.id);
  invites.push(pena.id);
  await d.users.put({ ...other, penaInvites: invites.slice(-MAX_PENA_INVITES) } as User);
  return { ok: true, value: { pena, other } };
}

/** Saca a alguien (o a ti mismo). Si se va el creador, pasa al más antiguo; si no queda nadie, se borra. */
async function removeMember(d: PenaDeps, pena: Pena, userId: string): Promise<Pena | null> {
  const members = pena.members.filter((m) => m.userId !== userId);
  const u = (await d.users.get(userId)) as PenaUser | null;
  if (u && u.penaId === pena.id) {
    const { penaId: _drop, ...rest } = u;
    await d.users.put(rest as User);
  }
  if (members.length === 0) {
    await d.penas.delete(pena.id);
    return null;
  }
  const ownerId = pena.ownerId === userId ? [...members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]!.userId : pena.ownerId;
  const next = { ...pena, members, ownerId };
  await d.penas.put(next);
  return next;
}

export async function leavePena(d: PenaDeps, meId: string): Promise<boolean> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  const pena = me?.penaId ? await d.penas.get(me.penaId) : null;
  if (!me || !pena) return false;
  await removeMember(d, pena, meId);
  return true;
}

export async function kickMember(d: PenaDeps, meId: string, otherId: string): Promise<Outcome<Pena | null>> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  const pena = me?.penaId ? await d.penas.get(me.penaId) : null;
  if (!pena) return fail(404, 'No estás en ninguna peña');
  if (pena.ownerId !== meId) return fail(403, 'Solo quien lleva la peña puede expulsar');
  if (otherId === meId) return fail(400, 'Para irte, usa "Salir de la peña"');
  if (!pena.members.some((m) => m.userId === otherId)) return fail(404, 'No está en tu peña');
  return { ok: true, value: await removeMember(d, pena, otherId) };
}

/** userIds de tu peña (sin ti). */
export async function penaMatesOf(d: Pick<PenaDeps, 'users' | 'penas'>, meId: string): Promise<string[]> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  const pena = me?.penaId ? await d.penas.get(me.penaId) : null;
  return pena ? pena.members.map((m) => m.userId).filter((x) => x !== meId) : [];
}

// ───────────── Vista ─────────────

export interface PenaMemberView {
  id: string;
  name: string;
  tag: string | null;
  division: Division | null;
  status: FriendStatus;
  owner: boolean;
  you: boolean;
  /** Nivel de la temporada (para ordenar el ranking de la peña). */
  rating: number;
  games: number;
  /** Puntos ganados esta semana (0 si no ha jugado). */
  weekPoints: number;
  weekGames: number;
}

export interface PenaView {
  id: string;
  name: string;
  placeName: string | null;
  code: string;
  youAreOwner: boolean;
  members: PenaMemberView[];
  /** S5-04: retos abiertos y los últimos terminados. */
  retos: RetoView[];
}

export interface ViewCtx {
  presence: Presence;
  playingPlayerIds: () => Set<string>;
  /** S5-04 (opcional en tests de peñas). */
  retos?: () => RetoDeps;
}

function memberStats(p: LinkedPlayer | null, now: Date) {
  if (!p) return { rating: 1000, games: 0, weekPoints: 0, weekGames: 0, division: null };
  const rating = rolloverSeason(p, now)?.rating ?? p.rating;
  const thisWeek = p.weekId === weekId(now);
  return {
    rating,
    games: p.games,
    weekPoints: thisWeek ? (p.weekPoints ?? 0) : 0,
    weekGames: thisWeek ? (p.weekGames ?? 0) : 0,
    division: divisionFor(rating, p.games),
  };
}

export async function penaView(d: PenaDeps, ctx: ViewCtx, pena: Pena, meId: string, now: Date = new Date()): Promise<PenaView> {
  const playing = ctx.playingPlayerIds();
  const members = await Promise.all(
    pena.members.map(async (m): Promise<PenaMemberView> => {
      const u = await d.users.get(m.userId).catch(() => null);
      const p = u ? await d.players.get(u.primaryPlayerId).catch(() => null) : null;
      const { name, tag } = displayName(p);
      const st = memberStats(p, now);
      const status: FriendStatus =
        u && playing.has(u.primaryPlayerId) ? 'playing' : ctx.presence.isOnline(m.userId, now.getTime()) ? 'online' : 'offline';
      return { id: m.userId, name, tag, division: st.division, status, owner: m.userId === pena.ownerId, you: m.userId === meId, rating: st.rating, games: st.games, weekPoints: st.weekPoints, weekGames: st.weekGames };
    }),
  );
  members.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'es'));
  return {
    id: pena.id,
    name: pena.name,
    placeName: pena.municipio ? municipioName(pena.municipio) : null,
    code: pena.code,
    youAreOwner: pena.ownerId === meId,
    members,
    retos: ctx.retos ? await retosOfPena(ctx.retos(), pena.id, now).catch(() => []) : [],
  };
}

// ───────────── Rutas ─────────────

export interface PenaRouteOptions {
  sessionOf: (req: { headers: { cookie?: string | undefined } }) => Session | null;
  deps: () => PenaDeps;
  presence: Presence;
  playingPlayerIds: () => Set<string>;
  notify?: (toUserId: string, kind: PushKind, msg: PushMessage) => void;
  /** S5-04: retos. Sin esto, no hay retos. */
  retos?: () => RetoRepo;
}

export function registerPenaRoutes(app: FastifyInstance, opts: PenaRouteOptions): void {
  const retoDeps = (): RetoDeps => {
    const d: RetoDeps = { ...opts.deps(), retos: opts.retos!() };
    if (opts.notify) {
      const notify = opts.notify;
      d.notify = (to, msg) => notify(to, 'reto', msg);
    }
    return d;
  };
  const ctx: ViewCtx = { presence: opts.presence, playingPlayerIds: opts.playingPlayerIds };
  if (opts.retos) ctx.retos = retoDeps;
  type Rep = { code: (n: number) => { send: (b: unknown) => unknown } };
  const err = (reply: Rep, o: { code: number; error: string }) => reply.code(o.code).send({ error: o.error });

  const mine = async (meId: string) => {
    const d = opts.deps();
    const me = (await d.users.get(meId)) as PenaUser | null;
    if (!me) return null;
    const pena = me.penaId ? await d.penas.get(me.penaId) : null;
    const invites = [];
    for (const id of me.penaInvites ?? []) {
      const p = await d.penas.get(id).catch(() => null);
      if (p) invites.push({ id: p.id, name: p.name, placeName: p.municipio ? municipioName(p.municipio) : null, members: p.members.length });
    }
    return { pena: pena ? await penaView(d, ctx, pena, meId) : null, invites };
  };

  app.get('/api/penas/mine', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para tener peña' });
    const v = await mine(s.uid);
    if (!v) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    return v;
  });

  app.post('/api/penas', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para tener peña' });
    const r = await createPena(opts.deps(), s.uid, (req.body as { name?: unknown } | undefined)?.name);
    if (!r.ok) return err(reply, r);
    return mine(s.uid);
  });

  app.get<{ Params: { code: string } }>('/api/penas/join/:code', async (req, reply) => {
    const p = await opts.deps().penas.byCode(req.params.code.trim().toUpperCase());
    if (!p) return reply.code(404).send({ error: 'Ese enlace de peña ya no vale' });
    const s = opts.sessionOf(req);
    return {
      name: p.name,
      placeName: p.municipio ? municipioName(p.municipio) : null,
      members: p.members.length,
      youAreIn: !!s && p.members.some((m) => m.userId === s.uid),
    };
  });

  app.post<{ Params: { code: string } }>('/api/penas/join/:code', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para entrar en la peña' });
    const r = await joinByCode(opts.deps(), s.uid, req.params.code);
    if (!r.ok) return err(reply, r);
    return mine(s.uid);
  });

  app.post<{ Params: { id: string } }>('/api/penas/invites/:id/accept', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const r = await acceptInvite(opts.deps(), s.uid, req.params.id);
    if (!r.ok) return err(reply, r);
    return mine(s.uid);
  });

  app.post<{ Params: { id: string } }>('/api/penas/invites/:id/decline', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    await declineInvite(opts.deps(), s.uid, req.params.id);
    return mine(s.uid);
  });

  app.post<{ Params: { userId: string } }>('/api/penas/mine/invite/:userId', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const d = opts.deps();
    // Solo a amigos: no se puede invitar a desconocidos.
    const me = (await d.users.get(s.uid)) as (PenaUser & { friends?: string[] }) | null;
    if (!me?.friends?.includes(req.params.userId)) return reply.code(404).send({ error: 'Solo puedes invitar a tus amigos' });
    const r = await inviteToPena(d, s.uid, req.params.userId);
    if (!r.ok) return err(reply, r);
    if (opts.notify) {
      const { name } = displayName(await d.players.get(me.primaryPlayerId).catch(() => null));
      opts.notify(req.params.userId, 'request', {
        title: 'Te invitan a una peña',
        body: `${name} te invita a la peña «${r.value.pena.name}»`,
        url: '/#pena',
        tag: `pena-${r.value.pena.id}`,
        ttl: 7 * 24 * 3600,
      });
    }
    return { ok: true };
  });

  app.post<{ Params: { userId: string } }>('/api/penas/mine/kick/:userId', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const r = await kickMember(opts.deps(), s.uid, req.params.userId);
    if (!r.ok) return err(reply, r);
    return mine(s.uid);
  });

  // ───── S5-04: retos ─────
  app.get<{ Querystring: { q?: string } }>('/api/penas/search', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const key = searchKey(String(req.query.q ?? '')).slice(0, 30);
    if (key.length < 2) return { results: [] };
    const d = opts.deps();
    const me = (await d.users.get(s.uid)) as PenaUser | null;
    const found = await d.penas.search(key, 11).catch(() => []);
    return {
      results: found
        .filter((p) => p.id !== me?.penaId)
        .slice(0, 10)
        .map((p) => ({ id: p.id, name: p.name, placeName: p.municipio ? municipioName(p.municipio) : null, members: p.members.length })),
    };
  });

  app.post('/api/penas/retos', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    if (!opts.retos) return reply.code(503).send({ error: 'Retos no disponibles' });
    const body = (req.body ?? {}) as { toPenaId?: unknown; games?: unknown };
    const r = await proposeReto(retoDeps(), s.uid, body.toPenaId, body.games);
    if (!r.ok) return err(reply, r);
    return mine(s.uid);
  });

  app.post<{ Params: { id: string; action: string } }>('/api/penas/retos/:id/:action', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    if (!opts.retos) return reply.code(503).send({ error: 'Retos no disponibles' });
    const action = req.params.action;
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return reply.code(404).send({ error: 'No existe' });
    const r = await answerReto(retoDeps(), s.uid, req.params.id, action);
    if (!r.ok) return err(reply, r);
    return mine(s.uid);
  });

  app.post('/api/penas/mine/leave', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    await leavePena(opts.deps(), s.uid);
    return mine(s.uid);
  });
}
