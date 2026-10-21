/**
 * S5-04: retos entre peñas.
 *
 * Quien lleva una peña reta a otra a N partidas (5, 10 o 20). Quien lleva
 * la otra acepta o rechaza (la propuesta caduca a los 3 días). Desde que
 * se acepta hay 7 días; cuentan las partidas (una mano completa) en las
 * que en un equipo solo hay gente de una peña y en el otro solo de la
 * otra (los huecos pueden ser bots; también valen las mesas privadas).
 * Termina al jugar las N partidas o al acabar el plazo: gana la peña con
 * más partidas ganadas (o empate).
 *
 * Contenedor `retos` (PK `/id`).
 */
import type { Container } from '@azure/cosmos';
import type { PlayerRepo, UserRepo } from './auth/accounts.js';
import type { Pena, PenaRepo, PenaUser } from './penas.js';
import type { PushMessage } from './push.js';

export const RETO_GAMES = [5, 10, 20] as const;
export const RETO_DAYS = 7;
export const RETO_PENDING_DAYS = 3;
/** Retos abiertos (propuestos o en juego) por peña, como mucho. */
export const MAX_OPEN_RETOS = 3;
const DAY = 86_400_000;

export type RetoStatus = 'pending' | 'active' | 'finished' | 'declined' | 'cancelled' | 'expired';
export type RetoSide = 'from' | 'to';

export interface Reto {
  id: string;
  fromPenaId: string;
  toPenaId: string;
  fromName: string;
  toName: string;
  games: number;
  status: RetoStatus;
  createdAt: string;
  startedAt?: string;
  endsAt?: string;
  finishedAt?: string;
  score: { from: number; to: number };
  winner?: RetoSide | 'draw';
}

export const isOpen = (r: Reto) => r.status === 'pending' || r.status === 'active';

// ───────────── Repos ─────────────

export interface RetoRepo {
  get(id: string): Promise<Reto | null>;
  put(r: Reto): Promise<void>;
  /** Los últimos retos de una peña (abiertos primero). */
  forPena(penaId: string, limit?: number): Promise<Reto[]>;
  /** Abiertos que ya deberían cerrarse (plazo o propuesta caducada). */
  dueBefore(now: Date): Promise<Reto[]>;
  /** Activos entre estas dos peñas (en cualquier sentido). */
  activeBetween(a: string, b: string): Promise<Reto[]>;
}

export class MemoryRetoRepo implements RetoRepo {
  readonly map = new Map<string, Reto>();
  async get(id: string) {
    const r = this.map.get(id);
    return r ? structuredClone(r) : null;
  }
  async put(r: Reto) {
    this.map.set(r.id, structuredClone(r));
  }
  async forPena(penaId: string, limit = 20) {
    return [...this.map.values()]
      .filter((r) => r.fromPenaId === penaId || r.toPenaId === penaId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async dueBefore(now: Date) {
    return [...this.map.values()].filter((r) => isDue(r, now)).map((r) => structuredClone(r));
  }
  async activeBetween(a: string, b: string) {
    return [...this.map.values()]
      .filter((r) => r.status === 'active' && ((r.fromPenaId === a && r.toPenaId === b) || (r.fromPenaId === b && r.toPenaId === a)))
      .map((r) => structuredClone(r));
  }
}

function clean(r: Reto): Reto {
  const out: Reto = {
    id: r.id,
    fromPenaId: r.fromPenaId,
    toPenaId: r.toPenaId,
    fromName: r.fromName,
    toName: r.toName,
    games: r.games,
    status: r.status,
    createdAt: r.createdAt,
    score: r.score,
  };
  if (r.startedAt) out.startedAt = r.startedAt;
  if (r.endsAt) out.endsAt = r.endsAt;
  if (r.finishedAt) out.finishedAt = r.finishedAt;
  if (r.winner) out.winner = r.winner;
  return out;
}

export class CosmosRetoRepo implements RetoRepo {
  constructor(private readonly c: Container) {}
  async get(id: string) {
    try {
      const { resource } = await this.c.item(id, id).read<Reto>();
      return resource ? clean(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }
  async put(r: Reto) {
    await this.c.items.upsert(r);
  }
  async forPena(penaId: string, limit = 20) {
    const { resources } = await this.c.items
      .query<Reto>({
        query: 'SELECT * FROM c WHERE c.fromPenaId = @p OR c.toPenaId = @p',
        parameters: [{ name: '@p', value: penaId }],
      })
      .fetchAll();
    return resources
      .map(clean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async dueBefore(now: Date) {
    const { resources } = await this.c.items
      .query<Reto>({
        query:
          "SELECT * FROM c WHERE (c.status = 'active' AND c.endsAt <= @now) OR (c.status = 'pending' AND c.createdAt <= @old)",
        parameters: [
          { name: '@now', value: now.toISOString() },
          { name: '@old', value: new Date(now.getTime() - RETO_PENDING_DAYS * DAY).toISOString() },
        ],
      })
      .fetchAll();
    return resources.map(clean);
  }
  async activeBetween(a: string, b: string) {
    const { resources } = await this.c.items
      .query<Reto>({
        query:
          "SELECT * FROM c WHERE c.status = 'active' AND ((c.fromPenaId = @a AND c.toPenaId = @b) OR (c.fromPenaId = @b AND c.toPenaId = @a))",
        parameters: [
          { name: '@a', value: a },
          { name: '@b', value: b },
        ],
      })
      .fetchAll();
    return resources.map(clean);
  }
}

const memoryRetos = new MemoryRetoRepo();
let override: RetoRepo | null = null;
export function retoRepo(getContainer: () => Container | null): RetoRepo {
  if (override) return override;
  const c = getContainer();
  return c ? new CosmosRetoRepo(c) : memoryRetos;
}
export function setRetoRepo(r: RetoRepo | null): void {
  override = r;
}

// ───────────── Reglas ─────────────

export function isDue(r: Reto, now: Date): boolean {
  if (r.status === 'active') return !!r.endsAt && Date.parse(r.endsAt) <= now.getTime();
  if (r.status === 'pending') return Date.parse(r.createdAt) + RETO_PENDING_DAYS * DAY <= now.getTime();
  return false;
}

function winnerOf(r: Reto): RetoSide | 'draw' {
  return r.score.from > r.score.to ? 'from' : r.score.to > r.score.from ? 'to' : 'draw';
}

/** Cierra si toca (plazo, N partidas jugadas, propuesta caducada). Devuelve el reto nuevo o null si no cambia. */
export function settle(r: Reto, now: Date): Reto | null {
  if (r.status === 'pending' && isDue(r, now)) return { ...r, status: 'expired', finishedAt: now.toISOString() };
  if (r.status === 'active' && (isDue(r, now) || r.score.from + r.score.to >= r.games)) {
    return { ...r, status: 'finished', finishedAt: now.toISOString(), winner: winnerOf(r) };
  }
  return null;
}

export interface RetoDeps {
  users: UserRepo;
  players: PlayerRepo;
  penas: PenaRepo;
  retos: RetoRepo;
  /** Aviso push a una cuenta (best-effort). */
  notify?: (toUserId: string, msg: PushMessage) => void;
}

type Fail = { ok: false; code: 400 | 403 | 404 | 409; error: string };
const fail = (code: Fail['code'], error: string): Fail => ({ ok: false, code, error });

async function myPenaAsOwner(d: RetoDeps, meId: string): Promise<Pena | Fail> {
  const me = (await d.users.get(meId)) as PenaUser | null;
  const pena = me?.penaId ? await d.penas.get(me.penaId) : null;
  if (!pena) return fail(404, 'No estás en ninguna peña');
  if (pena.ownerId !== meId) return fail(403, 'Solo quien lleva la peña puede hacer esto');
  return pena;
}

const isFail = (x: unknown): x is Fail => !!x && typeof x === 'object' && (x as Fail).ok === false;

async function openCount(d: RetoDeps, penaId: string, now: Date): Promise<Reto[]> {
  const list = await d.retos.forPena(penaId, 50);
  return list.filter((r) => isOpen(r) && !isDue(r, now));
}

function notifyPena(d: RetoDeps, pena: Pena | null, msg: PushMessage, exceptUserId?: string): void {
  if (!pena || !d.notify) return;
  for (const m of pena.members) if (m.userId !== exceptUserId) d.notify(m.userId, msg);
}

export async function proposeReto(
  d: RetoDeps,
  meId: string,
  toPenaId: unknown,
  games: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; value: Reto } | Fail> {
  const mine = await myPenaAsOwner(d, meId);
  if (isFail(mine)) return mine;
  if (typeof games !== 'number' || !(RETO_GAMES as readonly number[]).includes(games)) return fail(400, 'Elige 5, 10 o 20 partidas');
  if (typeof toPenaId !== 'string' || toPenaId === mine.id) return fail(400, 'Elige otra peña');
  const rival = await d.penas.get(toPenaId);
  if (!rival) return fail(404, 'Esa peña ya no existe');
  const openMine = await openCount(d, mine.id, now);
  if (openMine.some((r) => r.fromPenaId === rival.id || r.toPenaId === rival.id)) return fail(409, 'Ya tenéis un reto abierto con esa peña');
  if (openMine.length >= MAX_OPEN_RETOS) return fail(409, `Tu peña ya tiene ${MAX_OPEN_RETOS} retos abiertos`);
  if ((await openCount(d, rival.id, now)).length >= MAX_OPEN_RETOS) return fail(409, 'Esa peña ya tiene demasiados retos abiertos');
  const reto: Reto = {
    id: globalThis.crypto.randomUUID(),
    fromPenaId: mine.id,
    toPenaId: rival.id,
    fromName: mine.name,
    toName: rival.name,
    games,
    status: 'pending',
    createdAt: now.toISOString(),
    score: { from: 0, to: 0 },
  };
  await d.retos.put(reto);
  d.notify?.(rival.ownerId, {
    title: '¡Os retan!',
    body: `La peña «${mine.name}» reta a «${rival.name}» a ${games} partidas`,
    url: '/#pena',
    tag: `reto-${reto.id}`,
    ttl: RETO_PENDING_DAYS * 86_400,
  });
  return { ok: true, value: reto };
}

/** Aceptar / rechazar (la peña retada) o cancelar (la que reta). */
export async function answerReto(
  d: RetoDeps,
  meId: string,
  retoId: string,
  action: 'accept' | 'decline' | 'cancel',
  now: Date = new Date(),
): Promise<{ ok: true; value: Reto } | Fail> {
  const mine = await myPenaAsOwner(d, meId);
  if (isFail(mine)) return mine;
  const r = await d.retos.get(retoId);
  if (!r) return fail(404, 'Ese reto ya no existe');
  const expired = settle(r, now);
  if (expired) {
    await d.retos.put(expired);
    return fail(409, 'Ese reto ya ha caducado');
  }
  if (r.status !== 'pending') return fail(409, 'Ese reto ya no está pendiente');
  if (action === 'cancel') {
    if (r.fromPenaId !== mine.id) return fail(403, 'Solo la peña que reta puede cancelarlo');
    const next: Reto = { ...r, status: 'cancelled', finishedAt: now.toISOString() };
    await d.retos.put(next);
    return { ok: true, value: next };
  }
  if (r.toPenaId !== mine.id) return fail(403, 'Solo la peña retada puede responder');
  if (action === 'decline') {
    const next: Reto = { ...r, status: 'declined', finishedAt: now.toISOString() };
    await d.retos.put(next);
    return { ok: true, value: next };
  }
  const endsAt = new Date(now.getTime() + RETO_DAYS * DAY);
  const next: Reto = { ...r, status: 'active', startedAt: now.toISOString(), endsAt: endsAt.toISOString() };
  await d.retos.put(next);
  const msg: PushMessage = {
    title: '¡Empieza el reto!',
    body: `«${r.fromName}» contra «${r.toName}»: ${r.games} partidas en ${RETO_DAYS} días`,
    url: '/#pena',
    tag: `reto-${r.id}`,
    ttl: 86_400,
  };
  notifyPena(d, await d.penas.get(r.fromPenaId), msg);
  notifyPena(d, mine, msg);
  return { ok: true, value: next };
}

function finishMessage(r: Reto): PushMessage {
  const score = `${Math.max(r.score.from, r.score.to)}–${Math.min(r.score.from, r.score.to)}`;
  const body =
    r.winner === 'draw'
      ? `Empate ${r.score.from}–${r.score.to} entre «${r.fromName}» y «${r.toName}»`
      : `«${r.winner === 'from' ? r.fromName : r.toName}» gana el reto ${score} a «${r.winner === 'from' ? r.toName : r.fromName}»`;
  return { title: 'Reto terminado', body, url: '/#pena', tag: `reto-${r.id}`, ttl: 3 * 86_400 };
}

async function afterSettle(d: RetoDeps, r: Reto): Promise<void> {
  if (r.status !== 'finished') return;
  const msg = finishMessage(r);
  notifyPena(d, await d.penas.get(r.fromPenaId), msg);
  notifyPena(d, await d.penas.get(r.toPenaId), msg);
}

/** Cierra los retos vencidos (se llama de vez en cuando). */
export async function sweepRetos(d: RetoDeps, now: Date = new Date()): Promise<number> {
  let n = 0;
  for (const r of await d.retos.dueBefore(now)) {
    const next = settle(r, now);
    if (!next) continue;
    await d.retos.put(next);
    await afterSettle(d, next);
    n++;
  }
  return n;
}

/**
 * Fin de una partida: si en un equipo solo hay gente de la peña A y en el
 * otro solo de la peña B, y A y B tienen un reto en juego, cuenta.
 * `teams` = playerIds de los humanos de cada equipo.
 */
export async function countPartida(
  d: RetoDeps,
  teams: Record<0 | 1, string[]>,
  winner: 0 | 1,
  now: Date = new Date(),
): Promise<Reto[]> {
  if (teams[0].length === 0 || teams[1].length === 0) return [];
  const penaOfTeam = async (pids: string[]): Promise<string | null> => {
    const ids = new Set<string>();
    for (const pid of pids) {
      const p = await d.players.get(pid).catch(() => null);
      const uid = p?.userId;
      if (!uid) return null; // un invitado sin cuenta: el equipo no representa a una peña
      const u = (await d.users.get(uid).catch(() => null)) as PenaUser | null;
      if (!u?.penaId) return null;
      ids.add(u.penaId);
    }
    return ids.size === 1 ? [...ids][0]! : null;
  };
  const p0 = await penaOfTeam(teams[0]);
  const p1 = await penaOfTeam(teams[1]);
  if (!p0 || !p1 || p0 === p1) return [];
  const changed: Reto[] = [];
  for (const r of await d.retos.activeBetween(p0, p1)) {
    const done = settle(r, now);
    if (done) {
      // Vencido antes de esta partida: se cierra sin contarla.
      await d.retos.put(done);
      await afterSettle(d, done);
      continue;
    }
    const winnerPena = winner === 0 ? p0 : p1;
    const side: RetoSide = winnerPena === r.fromPenaId ? 'from' : 'to';
    let next: Reto = { ...r, score: { ...r.score, [side]: r.score[side] + 1 } };
    const closed = settle(next, now);
    if (closed) next = closed;
    await d.retos.put(next);
    if (closed) await afterSettle(d, next);
    changed.push(next);
  }
  return changed;
}

// ───────────── Vista (desde una peña) ─────────────

export interface RetoView {
  id: string;
  rivalId: string;
  rivalName: string;
  /** ¿Lo propuso tu peña? */
  weChallenged: boolean;
  games: number;
  status: RetoStatus;
  us: number;
  them: number;
  endsAt: string | null;
  /** Caducidad de la propuesta (pendiente). */
  expiresAt: string | null;
  result: 'win' | 'lose' | 'draw' | null;
}

export function retoView(r: Reto, penaId: string): RetoView {
  const we: RetoSide = r.fromPenaId === penaId ? 'from' : 'to';
  const they: RetoSide = we === 'from' ? 'to' : 'from';
  return {
    id: r.id,
    rivalId: we === 'from' ? r.toPenaId : r.fromPenaId,
    rivalName: we === 'from' ? r.toName : r.fromName,
    weChallenged: we === 'from',
    games: r.games,
    status: r.status,
    us: r.score[we],
    them: r.score[they],
    endsAt: r.endsAt ?? null,
    expiresAt: r.status === 'pending' ? new Date(Date.parse(r.createdAt) + RETO_PENDING_DAYS * DAY).toISOString() : null,
    result: r.status === 'finished' ? (r.winner === 'draw' ? 'draw' : r.winner === we ? 'win' : 'lose') : null,
  };
}

/** Lo que se enseña en la página de la peña: abiertos y los 3 últimos terminados. */
export async function retosOfPena(d: RetoDeps, penaId: string, now: Date = new Date()): Promise<RetoView[]> {
  const list = await d.retos.forPena(penaId, 30);
  const out: Reto[] = [];
  for (const r of list) {
    const next = settle(r, now);
    if (next) {
      await d.retos.put(next).catch(() => undefined);
      await afterSettle(d, next).catch(() => undefined);
      out.push(next);
    } else out.push(r);
  }
  const open = out.filter(isOpen);
  const done = out.filter((r) => r.status === 'finished').slice(0, 3);
  return [...open, ...done].map((r) => retoView(r, penaId));
}
