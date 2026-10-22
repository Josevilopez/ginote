/**
 * S5-01: amigos, quién está conectado e invitaciones dentro de la app.
 *
 * - Solo con cuenta. La lista vive en el doc del usuario (`users`):
 *   `friends`, `friendsIn` (solicitudes recibidas) y `friendsOut` (enviadas),
 *   todas con `userId`. Se añade por código público `Nombre#1234`.
 * - Presencia en memoria (una réplica): cualquier petición /api con sesión
 *   marca "visto ahora"; conectado = visto en el último minuto. "Jugando" =
 *   sentado en una mesa (se mira en las salas vivas).
 * - Invitaciones en memoria; caducan a los 2 minutos.
 *
 *  GET    /api/friends                      → { me, friends, mates, incoming, outgoing, invites }
 *  POST   /api/friends/request  {code}      → envía solicitud (o acepta si ya te la habían enviado)
 *  POST   /api/friends/:id/accept           → acepta
 *  POST   /api/friends/:id/reject           → rechaza (o cancela la tuya)
 *  DELETE /api/friends/:id                  → quita amigo
 *  POST   /api/friends/:id/invite {kind,code} → invita a tu pareja o mesa privada
 *  POST   /api/invites/:id/dismiss          → descarta una invitación recibida
 */
import type { FastifyInstance } from 'fastify';
import { divisionFor, rolloverSeason, type Division } from '@guinote/protocol';
import type { AuthRepos, sessionOf as SessionOfFn } from './auth/routes.js';
import type { LinkedPlayer, PlayerRepo, User, UserRepo } from './auth/accounts.js';
import type { PushKind, PushMessage } from './push.js';

export const MAX_FRIENDS = 200;
export const MAX_PENDING = 50;
export const ONLINE_WINDOW_MS = 60_000;
export const INVITE_TTL_MS = 2 * 60_000;

export type FriendStatus = 'online' | 'playing' | 'offline';
export type InviteKind = 'pareja' | 'mesa';

/** Campos de amistad en el doc del usuario (opcionales: docs viejos). */
export type FriendFields = { friends?: string[]; friendsIn?: string[]; friendsOut?: string[] };
type FUser = User & FriendFields;

export interface FriendView {
  id: string;
  name: string;
  tag: string | null;
  division: Division | null;
  status: FriendStatus;
}

export interface InviteView {
  id: string;
  fromId: string;
  fromName: string;
  kind: InviteKind;
  code: string;
  expiresInMs: number;
}

// ───────────── Código público "Nombre#1234" ─────────────

export function parseFriendCode(raw: unknown): { name: string; tag: string } | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(.{1,24}?)\s*#\s*(\d{4})$/u);
  if (!m) return null;
  const name = m[1]!.trim().replace(/\s+/g, ' ');
  return name ? { name, tag: m[2]! } : null;
}

// ───────────── Presencia ─────────────

export class Presence {
  private readonly seen = new Map<string, number>();
  touch(userId: string, now: number = Date.now()): void {
    this.seen.set(userId, now);
  }
  isOnline(userId: string, now: number = Date.now()): boolean {
    const t = this.seen.get(userId);
    return t !== undefined && now - t <= ONLINE_WINDOW_MS;
  }
  forget(userId: string): void {
    this.seen.delete(userId);
  }
  gc(now: number = Date.now()): void {
    for (const [k, t] of this.seen) if (now - t > ONLINE_WINDOW_MS * 5) this.seen.delete(k);
  }
}

// ───────────── Invitaciones ─────────────

export interface Invite {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  kind: InviteKind;
  code: string;
  expiresAt: number;
}

export class InviteBox {
  private readonly list: Invite[] = [];
  add(inv: Omit<Invite, 'id' | 'expiresAt'>, now: number = Date.now()): Invite {
    this.gc(now);
    // Una sola invitación viva por (de, para): la nueva sustituye a la vieja.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const x = this.list[i]!;
      if (x.fromId === inv.fromId && x.toId === inv.toId) this.list.splice(i, 1);
    }
    const full: Invite = { ...inv, id: globalThis.crypto.randomUUID(), expiresAt: now + INVITE_TTL_MS };
    this.list.push(full);
    return full;
  }
  forUser(userId: string, now: number = Date.now()): Invite[] {
    this.gc(now);
    return this.list.filter((x) => x.toId === userId);
  }
  dismiss(id: string, userId: string): boolean {
    const i = this.list.findIndex((x) => x.id === id && x.toId === userId);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }
  /** Borra todo lo que tenga que ver con este usuario (amistad rota, cuenta borrada). */
  dropBetween(a: string, b?: string): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const x = this.list[i]!;
      const hit = b === undefined ? x.fromId === a || x.toId === a : (x.fromId === a && x.toId === b) || (x.fromId === b && x.toId === a);
      if (hit) this.list.splice(i, 1);
    }
  }
  gc(now: number = Date.now()): void {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.expiresAt <= now) this.list.splice(i, 1);
  }
}

// ───────────── Lógica de amistad (sobre los repos) ─────────────

const without = (xs: string[] | undefined, id: string) => (xs ?? []).filter((x) => x !== id);
const withId = (xs: string[] | undefined, id: string) => ((xs ?? []).includes(id) ? [...(xs ?? [])] : [...(xs ?? []), id]);

export type RequestOutcome =
  | { ok: true; status: 'sent' | 'friends' | 'already-friends' | 'already-sent'; friendId: string }
  | { ok: false; code: 400 | 404 | 409; error: string };

export interface FindByNameTag {
  findByNameTag(name: string, tag: string): Promise<LinkedPlayer | null>;
}

export async function sendRequest(users: UserRepo, players: PlayerRepo & FindByNameTag, meId: string, rawCode: unknown): Promise<RequestOutcome> {
  const code = parseFriendCode(rawCode);
  if (!code) return { ok: false, code: 400, error: 'Escribe el código completo, por ejemplo Pilar#1234' };
  const target = await players.findByNameTag(code.name, code.tag);
  if (!target?.userId) return { ok: false, code: 404, error: 'No hay nadie con ese código. Revisa el nombre y los 4 números.' };
  const otherId = target.userId;
  if (otherId === meId) return { ok: false, code: 400, error: 'Ese es tu propio código 🙂' };
  return sendRequestTo(users, meId, otherId);
}

/** Solicitud a una cuenta concreta (por código o desde la mesa). */
export async function sendRequestTo(users: UserRepo, meId: string, otherId: string): Promise<RequestOutcome> {
  if (otherId === meId) return { ok: false, code: 400, error: 'No puedes añadirte a ti mismo' };
  const me = (await users.get(meId)) as FUser | null;
  const other = (await users.get(otherId)) as FUser | null;
  if (!me || !other) return { ok: false, code: 404, error: 'Esa cuenta ya no existe' };
  if (me.friends?.includes(otherId)) return { ok: true, status: 'already-friends', friendId: otherId };
  // Te la había enviado él/ella: se acepta directamente.
  if (me.friendsIn?.includes(otherId)) return acceptBetween(users, me, other);
  if (me.friendsOut?.includes(otherId)) return { ok: true, status: 'already-sent', friendId: otherId };
  if ((me.friends?.length ?? 0) >= MAX_FRIENDS) return { ok: false, code: 409, error: `Ya tienes ${MAX_FRIENDS} amigos, el máximo.` };
  if ((me.friendsOut?.length ?? 0) >= MAX_PENDING) return { ok: false, code: 409, error: 'Tienes demasiadas solicitudes sin responder.' };
  if ((other.friendsIn?.length ?? 0) >= MAX_PENDING) return { ok: false, code: 409, error: 'Esa persona tiene demasiadas solicitudes pendientes.' };
  await users.put({ ...me, friendsOut: withId(me.friendsOut, otherId) } as User);
  await users.put({ ...other, friendsIn: withId(other.friendsIn, meId) } as User);
  return { ok: true, status: 'sent', friendId: otherId };
}

async function acceptBetween(users: UserRepo, me: FUser, other: FUser): Promise<RequestOutcome> {
  if ((me.friends?.length ?? 0) >= MAX_FRIENDS || (other.friends?.length ?? 0) >= MAX_FRIENDS) {
    return { ok: false, code: 409, error: `Se ha llegado al máximo de ${MAX_FRIENDS} amigos.` };
  }
  await users.put({
    ...me,
    friends: withId(me.friends, other.userId),
    friendsIn: without(me.friendsIn, other.userId),
    friendsOut: without(me.friendsOut, other.userId),
  } as User);
  await users.put({
    ...other,
    friends: withId(other.friends, me.userId),
    friendsIn: without(other.friendsIn, me.userId),
    friendsOut: without(other.friendsOut, me.userId),
  } as User);
  return { ok: true, status: 'friends', friendId: other.userId };
}

export async function acceptRequest(users: UserRepo, meId: string, otherId: string): Promise<RequestOutcome> {
  const me = (await users.get(meId)) as FUser | null;
  const other = (await users.get(otherId)) as FUser | null;
  if (!me || !me.friendsIn?.includes(otherId)) return { ok: false, code: 404, error: 'Esa solicitud ya no existe' };
  if (!other) {
    await users.put({ ...me, friendsIn: without(me.friendsIn, otherId) } as User);
    return { ok: false, code: 404, error: 'Esa cuenta ya no existe' };
  }
  return acceptBetween(users, me, other);
}

/** Rechaza una solicitud recibida, cancela una enviada o quita una amistad: deja a los dos sin relación. */
export async function unlink(users: UserRepo, meId: string, otherId: string): Promise<boolean> {
  const me = (await users.get(meId)) as FUser | null;
  if (!me) return false;
  const had = !!(me.friends?.includes(otherId) || me.friendsIn?.includes(otherId) || me.friendsOut?.includes(otherId));
  if (had) {
    await users.put({ ...me, friends: without(me.friends, otherId), friendsIn: without(me.friendsIn, otherId), friendsOut: without(me.friendsOut, otherId) } as User);
  }
  const other = (await users.get(otherId)) as FUser | null;
  if (other && (other.friends?.includes(meId) || other.friendsIn?.includes(meId) || other.friendsOut?.includes(meId))) {
    await users.put({
      ...other,
      friends: without(other.friends, meId),
      friendsIn: without(other.friendsIn, meId),
      friendsOut: without(other.friendsOut, meId),
    } as User);
  }
  return had;
}

/** Al borrar una cuenta: se quita de las listas de todos los que la tenían. */
export async function forgetUser(users: UserRepo, meId: string): Promise<void> {
  const me = (await users.get(meId)) as FUser | null;
  if (!me) return;
  for (const id of new Set([...(me.friends ?? []), ...(me.friendsIn ?? []), ...(me.friendsOut ?? [])])) {
    await unlink(users, meId, id);
  }
}

// ───────────── Vista ─────────────

export function displayName(p: LinkedPlayer | null): { name: string; tag: string | null } {
  return { name: p?.publicName ?? p?.name ?? 'Jugador', tag: p?.tag ?? null };
}

export interface ViewDeps {
  users: UserRepo;
  players: PlayerRepo;
  presence: Presence;
  invites: InviteBox;
  /** playerIds sentados ahora mismo en alguna mesa. */
  playingPlayerIds: () => Set<string>;
  /** S5-03: compañeros de peña (userIds, sin ti). */
  penaMates?: (meId: string) => Promise<string[]>;
}

async function personView(deps: ViewDeps, userId: string, playing: Set<string>, now: number): Promise<FriendView | null> {
  const u = await deps.users.get(userId).catch(() => null);
  if (!u) return null;
  const p = await deps.players.get(u.primaryPlayerId).catch(() => null);
  const { name, tag } = displayName(p);
  const rating = p ? (rolloverSeason(p, new Date(now))?.rating ?? p.rating) : 1000;
  const status: FriendStatus = playing.has(u.primaryPlayerId) ? 'playing' : deps.presence.isOnline(userId, now) ? 'online' : 'offline';
  return { id: userId, name, tag, division: p ? divisionFor(rating, p.games) : null, status };
}

const ORDER: Record<FriendStatus, number> = { online: 0, playing: 1, offline: 2 };

export async function friendsView(deps: ViewDeps, meId: string, now: number = Date.now()) {
  const me = (await deps.users.get(meId)) as FUser | null;
  if (!me) return null;
  const playing = deps.playingPlayerIds();
  const load = async (ids: string[] | undefined) =>
    (await Promise.all((ids ?? []).map((id) => personView(deps, id, playing, now)))).filter((x): x is FriendView => !!x);
  const friends = (await load(me.friends)).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, 'es'));
  const incoming = await load(me.friendsIn);
  const outgoing = await load(me.friendsOut);
  const mine = displayName(await deps.players.get(me.primaryPlayerId).catch(() => null));
  // S5-03: los de tu peña que no son ya amigos (para invitarles a jugar).
  const mateIds: string[] = deps.penaMates ? await deps.penaMates(meId).catch(() => []) : [];
  const mates = (await load(mateIds.filter((id) => !me.friends?.includes(id)))).sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, 'es'),
  );
  const invites: InviteView[] = deps.invites
    .forUser(meId, now)
    .filter((i) => me.friends?.includes(i.fromId) || mateIds.includes(i.fromId))
    .map((i) => ({ id: i.id, fromId: i.fromId, fromName: i.fromName, kind: i.kind, code: i.code, expiresInMs: i.expiresAt - now }));
  return { me: mine, friends, mates, incoming, outgoing, invites };
}

// ───────────── Rutas ─────────────

export type SeatRelation = 'friends' | 'sent' | 'incoming' | 'none';

/** Quién está sentado en una mesa (asiento → playerId), o null si la mesa no existe. */
export type TableSeats = (roomCode: string) => { seat: number; playerId: string | null }[] | null;

/**
 * Jugadores de la mesa a los que puedes pedir amistad (con cuenta, que no
 * seas tú). Solo si tú estás sentado en ella. No se devuelve ningún dato
 * de su cuenta: solo el asiento y la relación contigo.
 */
export async function tableRelations(
  users: UserRepo,
  players: PlayerRepo,
  seats: { seat: number; playerId: string | null }[],
  meId: string,
  myPid: string,
): Promise<{ seat: number; relation: SeatRelation }[] | null> {
  if (!seats.some((x) => x.playerId === myPid)) return null;
  const me = (await users.get(meId)) as FUser | null;
  if (!me) return null;
  const out: { seat: number; relation: SeatRelation }[] = [];
  for (const { seat, playerId } of seats) {
    if (!playerId || playerId === myPid) continue;
    const p = await players.get(playerId).catch(() => null);
    const uid = p?.userId;
    if (!uid || uid === meId || p?.mergedInto) continue;
    const relation: SeatRelation = me.friends?.includes(uid)
      ? 'friends'
      : me.friendsOut?.includes(uid)
        ? 'sent'
        : me.friendsIn?.includes(uid)
          ? 'incoming'
          : 'none';
    out.push({ seat, relation });
  }
  return out;
}

export interface FriendRouteOptions {
  repos: () => AuthRepos & { players: PlayerRepo & FindByNameTag };
  sessionOf: typeof SessionOfFn;
  presence?: Presence;
  invites?: InviteBox;
  playingPlayerIds: () => Set<string>;
  /** ¿Se puede invitar a esta pareja / mesa? (existe y tiene hueco) */
  canInvite: (kind: InviteKind, code: string, fromPlayerId: string) => boolean;
  /** S5-03: compañeros de peña (se les puede invitar a jugar aunque no sean amigos). */
  penaMates?: (meId: string) => Promise<string[]>;
  /** Asientos de una mesa (para "Añadir amigo" al terminar el coto). */
  tableSeats?: TableSeats;
  /** S5-02: aviso push (best-effort, no se espera). */
  notify?: (toUserId: string, kind: PushKind, msg: PushMessage) => void;
}

export const presence = new Presence();
export const inviteBox = new InviteBox();

export function registerFriendRoutes(app: FastifyInstance, opts: FriendRouteOptions): void {
  const pres = opts.presence ?? presence;
  const box = opts.invites ?? inviteBox;

  // Cualquier petición con sesión cuenta como "conectado".
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const s = opts.sessionOf(req);
    if (s) pres.touch(s.uid);
  });

  const deps = (): ViewDeps => {
    const { users, players } = opts.repos();
    const d: ViewDeps = { users, players, presence: pres, invites: box, playingPlayerIds: opts.playingPlayerIds };
    if (opts.penaMates) d.penaMates = opts.penaMates;
    return d;
  };

  app.get('/api/friends', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para tener amigos' });
    const v = await friendsView(deps(), s.uid);
    if (!v) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    return v;
  });

  app.post('/api/friends/request', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para tener amigos' });
    const { users, players } = opts.repos();
    const r = await sendRequest(users, players, s.uid, (req.body as { code?: unknown } | undefined)?.code);
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    if (r.status === 'sent') await notifyRequest(s.uid, r.friendId);
    return { status: r.status };
  });

  const notifyRequest = async (fromId: string, toId: string) => {
    if (!opts.notify) return;
    const { users, players } = opts.repos();
    const me = await users.get(fromId).catch(() => null);
    const { name } = displayName(me ? await players.get(me.primaryPlayerId).catch(() => null) : null);
    opts.notify(toId, 'request', {
      title: 'Solicitud de amistad',
      body: `${name} quiere ser tu amigo en el guiñote`,
      url: '/#amigos',
      tag: `req-${fromId}`,
      ttl: 7 * 24 * 3600,
    });
  };

  // Al terminar el coto: a quién de la mesa puedes pedir amistad.
  app.get<{ Params: { code: string } }>('/api/friends/table/:code', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return { seats: [] };
    const seats = opts.tableSeats?.(req.params.code.toUpperCase()) ?? null;
    if (!seats) return reply.code(404).send({ error: 'Esa mesa ya no existe' });
    const { users, players } = opts.repos();
    const rel = await tableRelations(users, players, seats, s.uid, s.pid);
    return { seats: rel ?? [] };
  });

  app.post<{ Params: { code: string; seat: string } }>('/api/friends/table/:code/:seat', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para tener amigos' });
    const seats = opts.tableSeats?.(req.params.code.toUpperCase()) ?? null;
    if (!seats) return reply.code(404).send({ error: 'Esa mesa ya no existe' });
    if (!seats.some((x) => x.playerId === s.pid)) return reply.code(403).send({ error: 'No estás en esa mesa' });
    const seat = Number(req.params.seat);
    const target = seats.find((x) => x.seat === seat);
    const { users, players } = opts.repos();
    const p = target?.playerId ? await players.get(target.playerId).catch(() => null) : null;
    if (!p?.userId || p.mergedInto) return reply.code(404).send({ error: 'Ese jugador no tiene cuenta' });
    const r = await sendRequestTo(users, s.uid, p.userId);
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    if (r.status === 'sent') await notifyRequest(s.uid, r.friendId);
    return { status: r.status };
  });

  app.post<{ Params: { id: string } }>('/api/friends/:id/accept', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const r = await acceptRequest(opts.repos().users, s.uid, req.params.id);
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    return { status: r.status };
  });

  const drop = async (req: { params: { id: string }; headers: { cookie?: string | undefined } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    await unlink(opts.repos().users, s.uid, req.params.id);
    box.dropBetween(s.uid, req.params.id);
    return { ok: true };
  };
  app.post<{ Params: { id: string } }>('/api/friends/:id/reject', drop);
  app.delete<{ Params: { id: string } }>('/api/friends/:id', drop);

  app.post<{ Params: { id: string } }>('/api/friends/:id/invite', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const body = (req.body ?? {}) as { kind?: unknown; code?: unknown };
    const kind = body.kind === 'pareja' || body.kind === 'mesa' ? body.kind : null;
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!kind || !/^[A-Z0-9]{3,8}$/.test(code)) return reply.code(400).send({ error: 'Invitación no válida' });
    const { users, players } = opts.repos();
    const me = (await users.get(s.uid)) as FUser | null;
    if (!me) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    const mates: string[] = opts.penaMates ? await opts.penaMates(s.uid).catch(() => []) : [];
    if (!me.friends?.includes(req.params.id) && !mates.includes(req.params.id)) return reply.code(404).send({ error: 'No sois amigos' });
    if (!opts.canInvite(kind, code, s.pid)) {
      return reply.code(409).send({ error: kind === 'pareja' ? 'Tu pareja ya está completa o ya no existe' : 'La mesa ya no tiene sitio' });
    }
    const { name } = displayName(await players.get(me.primaryPlayerId).catch(() => null));
    box.add({ fromId: s.uid, fromName: name, toId: req.params.id, kind, code });
    // S5-02: si no tiene la web abierta, aviso push (con la web abierta ya le sale dentro).
    if (opts.notify && !pres.isOnline(req.params.id)) {
      opts.notify(req.params.id, 'invite', {
        title: '¡Te invitan a jugar!',
        body: kind === 'pareja' ? `${name} te invita a jugar de pareja` : `${name} te invita a su mesa privada`,
        url: kind === 'pareja' ? `/#pareja-${code}` : `/#${code}`,
        tag: `inv-${s.uid}`,
        ttl: Math.round(INVITE_TTL_MS / 1000),
      });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/invites/:id/dismiss', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    box.dismiss(req.params.id, s.uid);
    return { ok: true };
  });
}
