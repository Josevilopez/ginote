/**
 * S5-05: torneos de parejas por eliminatorias.
 *
 * - Los crea un administrador (`ADMIN_EMAILS`): nombre, plazas (8 o 16
 *   parejas), fin de la inscripción, días por ronda y partidas por cruce
 *   (1 o 3).
 * - Inscripción: una persona con cuenta apunta a un amigo como pareja; el
 *   amigo confirma. Hasta que se cierre la inscripción, cualquiera de los
 *   dos puede borrarse.
 * - Al cerrar la inscripción (o si el admin lo empieza antes) se hace el
 *   cuadro: por nivel medio de la pareja, las mejores con "pase directo"
 *   si faltan parejas. Cada ronda tiene fecha límite: "jugad cuando
 *   queráis antes del…".
 * - Cada cruce tiene su mesa: cuando alguien pulsa "Ir a la mesa" se crea
 *   (si no existe) y se le reserva su silla (pareja A en 0-2, pareja B en
 *   1-3). Empieza sola cuando están los cuatro; sin bots de relleno. El
 *   resultado llega solo al terminar la mesa.
 * - Al vencer la ronda, cruce sin jugar: si solo una pareja se presentó
 *   (pulsó "Ir a la mesa"), pasa ella; si no, sorteo.
 * - Campeón: insignia en el perfil de los dos (`trophies` en `users`).
 *
 * Contenedor `torneos` (PK `/id`), un documento por torneo.
 */
import type { Container } from '@azure/cosmos';
import type { FastifyInstance } from 'fastify';
import type { LinkedPlayer, PlayerRepo, User, UserRepo } from './auth/accounts.js';
import type { Session } from './auth/session.js';
import { displayName } from './friends.js';
import type { PushMessage } from './push.js';

const DAY = 86_400_000;
export const TORNEO_SIZES = [8, 16] as const;
export const TORNEO_PARTIDAS = [1, 3] as const;

export type TorneoStatus = 'open' | 'running' | 'finished' | 'cancelled';
export type MatchResult = 'played' | 'bye' | 'walkover' | 'sorteo';

export interface Entry {
  id: string;
  /** Quien apunta a la pareja. */
  a: string;
  /** La pareja (tiene que confirmar). */
  b: string;
  confirmed: boolean;
  createdAt: string;
  /** Nivel medio al empezar (para el cuadro). */
  seedRating?: number;
}

export interface TMatch {
  id: string;
  a: string | null;
  b: string | null;
  winner: string | null;
  result?: MatchResult;
  /** Partidas ganadas (a, b) si se jugó. */
  score?: [number, number];
  roomCode?: string;
  /** Parejas que pulsaron "Ir a la mesa" (para el no presentado). */
  showed: string[];
}

export interface Torneo {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  size: number;
  partidas: number;
  roundDays: number;
  signupUntil: string;
  status: TorneoStatus;
  entries: Entry[];
  startedAt?: string;
  roundDeadlines?: string[];
  rounds?: TMatch[][];
  champion?: string;
  finishedAt?: string;
}

export type Trophy = { torneoId: string; name: string; at: string };
type TUser = User & { friends?: string[]; trophies?: Trophy[] };

// ───────────── Repos ─────────────

export interface TorneoRepo {
  get(id: string): Promise<Torneo | null>;
  put(t: Torneo): Promise<void>;
  /** Los últimos (abiertos y en juego primero). */
  list(limit: number): Promise<Torneo[]>;
}

export class MemoryTorneoRepo implements TorneoRepo {
  readonly map = new Map<string, Torneo>();
  async get(id: string) {
    const t = this.map.get(id);
    return t ? structuredClone(t) : null;
  }
  async put(t: Torneo) {
    this.map.set(t.id, structuredClone(t));
  }
  async list(limit: number) {
    return [...this.map.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }
}

/** Quita los campos internos de Cosmos (`_rid`, `_etag`…). */
function strip(t: object): Torneo {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) if (!k.startsWith('_')) out[k] = v;
  return out as unknown as Torneo;
}

export class CosmosTorneoRepo implements TorneoRepo {
  constructor(private readonly c: Container) {}
  async get(id: string) {
    try {
      const { resource } = await this.c.item(id, id).read<Torneo>();
      return resource ? strip(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }
  async put(t: Torneo) {
    await this.c.items.upsert(t);
  }
  async list(limit: number) {
    const { resources } = await this.c.items
      .query<Torneo>({ query: 'SELECT TOP @n * FROM c ORDER BY c.createdAt DESC', parameters: [{ name: '@n', value: limit }] })
      .fetchAll();
    return resources.map((r) => strip(r));
  }
}

const memoryTorneos = new MemoryTorneoRepo();
let override: TorneoRepo | null = null;
export function torneoRepo(getContainer: () => Container | null): TorneoRepo {
  if (override) return override;
  const c = getContainer();
  return c ? new CosmosTorneoRepo(c) : memoryTorneos;
}
export function setTorneoRepo(r: TorneoRepo | null): void {
  override = r;
}

/** Un torneo se modifica de uno en uno (resultados y barrido pueden coincidir). */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

// ───────────── Cuadro (lógica pura) ─────────────

/** Orden clásico de cabezas de serie: 8 → [1,8,4,5,2,7,3,6]. */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((x) => [x, n - x]);
  }
  return order;
}

export function nextPow2(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/** Monta el cuadro con las parejas confirmadas, ya ordenadas por nivel (mejor primero). */
export function buildBracket(seeded: string[]): TMatch[][] {
  const P = nextPow2(seeded.length);
  const order = seedOrder(P);
  const rounds: TMatch[][] = [];
  const first: TMatch[] = [];
  for (let m = 0; m < P / 2; m++) {
    const sa = order[2 * m]!;
    const sb = order[2 * m + 1]!;
    first.push({ id: `r0m${m}`, a: seeded[sa - 1] ?? null, b: seeded[sb - 1] ?? null, winner: null, showed: [] });
  }
  rounds.push(first);
  for (let r = 1, n = P / 4; n >= 1; r++, n /= 2) {
    rounds.push(Array.from({ length: n }, (_, m) => ({ id: `r${r}m${m}`, a: null, b: null, winner: null, showed: [] })));
  }
  return rounds;
}

export function findMatch(t: Torneo, matchId: string): { r: number; m: number; match: TMatch } | null {
  const rounds = t.rounds ?? [];
  for (let r = 0; r < rounds.length; r++) {
    const m = rounds[r]!.findIndex((x) => x.id === matchId);
    if (m >= 0) return { r, m, match: rounds[r]![m]! };
  }
  return null;
}

export interface Advance {
  /** Cruces que acaban de quedar listos para jugar (las dos parejas). */
  ready: TMatch[];
  champion: string | null;
}

/** Pone ganador a un cruce y lo pasa a la ronda siguiente (muta `t`). */
export function setWinner(t: Torneo, matchId: string, winner: string, result: MatchResult, now: Date, score?: [number, number]): Advance {
  const out: Advance = { ready: [], champion: null };
  const found = findMatch(t, matchId);
  if (!found || found.match.winner) return out;
  const { r, m, match } = found;
  match.winner = winner;
  match.result = result;
  if (score) match.score = score;
  const rounds = t.rounds!;
  if (r === rounds.length - 1) {
    t.champion = winner;
    t.status = 'finished';
    t.finishedAt = now.toISOString();
    out.champion = winner;
    return out;
  }
  const next = rounds[r + 1]![Math.floor(m / 2)]!;
  if (m % 2 === 0) next.a = winner;
  else next.b = winner;
  if (next.a && next.b) out.ready.push(next);
  return out;
}

/** Cierra la inscripción y monta el cuadro (muta `t`). Pases directos incluidos. */
export function startTorneo(t: Torneo, ratingOf: (e: Entry) => number, now: Date): Advance {
  const out: Advance = { ready: [], champion: null };
  const confirmed = t.entries.filter((e) => e.confirmed);
  if (confirmed.length < 2) {
    t.status = 'cancelled';
    t.finishedAt = now.toISOString();
    return out;
  }
  for (const e of confirmed) e.seedRating = Math.round(ratingOf(e));
  const seeded = [...confirmed].sort((x, y) => (y.seedRating ?? 0) - (x.seedRating ?? 0)).map((e) => e.id);
  t.entries = confirmed; // las no confirmadas se quedan fuera
  t.rounds = buildBracket(seeded);
  t.status = 'running';
  t.startedAt = now.toISOString();
  t.roundDeadlines = t.rounds.map((_, r) => new Date(now.getTime() + (r + 1) * t.roundDays * DAY).toISOString());
  for (const match of t.rounds[0]!) {
    if (match.a && !match.b) merge(out, setWinner(t, match.id, match.a, 'bye', now));
    else if (!match.a && match.b) merge(out, setWinner(t, match.id, match.b, 'bye', now));
    else if (match.a && match.b) out.ready.push(match);
  }
  return out;
}

function merge(into: Advance, more: Advance): void {
  into.ready.push(...more.ready);
  if (more.champion) into.champion = more.champion;
}

/**
 * Rondas vencidas: los cruces sin jugar se deciden (presentado o sorteo).
 * `isLive(code)` = la mesa de ese cruce está en juego (se le deja acabar).
 */
export function resolveDeadlines(t: Torneo, now: Date, isLive: (code: string) => boolean, random: () => number = Math.random): Advance {
  const out: Advance = { ready: [], champion: null };
  if (t.status !== 'running' || !t.rounds || !t.roundDeadlines) return out;
  for (let r = 0; r < t.rounds.length; r++) {
    if (Date.parse(t.roundDeadlines[r]!) > now.getTime()) break;
    for (const match of t.rounds[r]!) {
      if (match.winner || !match.a || !match.b) continue;
      if (match.roomCode && isLive(match.roomCode)) continue;
      const showedA = match.showed.includes(match.a);
      const showedB = match.showed.includes(match.b);
      if (showedA !== showedB) merge(out, setWinner(t, match.id, showedA ? match.a : match.b, 'walkover', now));
      else merge(out, setWinner(t, match.id, random() < 0.5 ? match.a : match.b, 'sorteo', now));
    }
  }
  return out;
}

/** Cruce pendiente de una pareja (el de la ronda más avanzada sin ganador). */
export function pendingMatchOf(t: Torneo, entryId: string): { r: number; match: TMatch } | null {
  if (t.status !== 'running' || !t.rounds) return null;
  for (let r = t.rounds.length - 1; r >= 0; r--) {
    const match = t.rounds[r]!.find((x) => !x.winner && (x.a === entryId || x.b === entryId));
    if (match) return { r, match };
  }
  return null;
}

// ───────────── Servicio ─────────────

export interface TableOps {
  /** Crea la mesa del cruce. Devuelve el código. */
  open(t: Torneo, match: TMatch, label: string): string;
  /** Reserva la silla y devuelve el token, o null si la mesa ya no vale. */
  reserve(code: string, seat: 0 | 1 | 2 | 3, who: { name: string; playerId: string }): string | null;
  /** 'none' (no existe o terminó), 'lobby' o 'playing'. */
  state(code: string): 'none' | 'lobby' | 'playing';
}

export interface TorneoDeps {
  users: UserRepo;
  players: PlayerRepo;
  torneos: TorneoRepo;
  tables?: TableOps;
  notify?: (toUserId: string, msg: PushMessage) => void;
  adminEmails: string[];
}

type Fail = { ok: false; code: 400 | 403 | 404 | 409; error: string };
const fail = (code: Fail['code'], error: string): Fail => ({ ok: false, code, error });
type Ok<T> = { ok: true; value: T };

async function pairNames(d: TorneoDeps, e: Entry | undefined): Promise<string> {
  if (!e) return '¿?';
  const name = async (uid: string) => {
    const u = await d.users.get(uid).catch(() => null);
    return displayName(u ? await d.players.get(u.primaryPlayerId).catch(() => null) : null).name;
  };
  return `${await name(e.a)} y ${await name(e.b)}`;
}

function deadlineLabel(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

/** Avisos tras un cambio de cuadro (cruces listos, campeón). */
async function announce(d: TorneoDeps, t: Torneo, adv: Advance): Promise<void> {
  if (!d.notify) return;
  const byId = new Map(t.entries.map((e) => [e.id, e]));
  const url = `/#torneo-${t.id}`;
  for (const match of adv.ready) {
    const found = findMatch(t, match.id);
    const deadline = found ? t.roundDeadlines?.[found.r] : undefined;
    for (const [mine, theirs] of [
      [match.a, match.b],
      [match.b, match.a],
    ] as const) {
      const e = byId.get(mine!);
      if (!e) continue;
      const rival = await pairNames(d, byId.get(theirs!));
      const msg: PushMessage = {
        title: t.name,
        body: `Os toca contra ${rival}${deadline ? `. Tenéis hasta el ${deadlineLabel(deadline)}` : ''}`,
        url,
        tag: `torneo-${t.id}`,
        ttl: t.roundDays * 86_400,
      };
      d.notify(e.a, msg);
      d.notify(e.b, msg);
    }
  }
  if (adv.champion) {
    const champ = byId.get(adv.champion);
    const names = await pairNames(d, champ);
    const msg: PushMessage = { title: t.name, body: `¡${names} ganan el torneo! 🏆`, url, tag: `torneo-${t.id}`, ttl: 3 * 86_400 };
    for (const e of t.entries) {
      d.notify(e.a, msg);
      d.notify(e.b, msg);
    }
  }
}

/** Insignia de campeón a los dos. */
async function giveTrophies(d: TorneoDeps, t: Torneo): Promise<void> {
  const champ = t.entries.find((e) => e.id === t.champion);
  if (!champ) return;
  for (const uid of [champ.a, champ.b]) {
    const u = (await d.users.get(uid)) as TUser | null;
    if (!u || u.trophies?.some((x) => x.torneoId === t.id)) continue;
    await d.users.put({ ...u, trophies: [...(u.trophies ?? []), { torneoId: t.id, name: t.name, at: t.finishedAt ?? new Date().toISOString() }] } as User);
  }
}

async function afterAdvance(d: TorneoDeps, t: Torneo, adv: Advance): Promise<void> {
  if (adv.champion) await giveTrophies(d, t).catch(() => undefined);
  await announce(d, t, adv).catch(() => undefined);
}

export async function isAdmin(d: TorneoDeps, uid: string): Promise<boolean> {
  if (d.adminEmails.length === 0) return false;
  const u = await d.users.get(uid).catch(() => null);
  return !!u?.email && d.adminEmails.includes(u.email.toLowerCase());
}

export async function createTorneo(
  d: TorneoDeps,
  uid: string,
  body: { name?: unknown; size?: unknown; partidas?: unknown; roundDays?: unknown; signupUntil?: unknown },
  now: Date = new Date(),
): Promise<Ok<Torneo> | Fail> {
  if (!(await isAdmin(d, uid))) return fail(403, 'Solo un administrador puede crear torneos');
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  if (name.length < 3) return fail(400, 'Ponle un nombre al torneo');
  if (typeof body.size !== 'number' || !(TORNEO_SIZES as readonly number[]).includes(body.size)) return fail(400, 'Plazas: 8 o 16 parejas');
  if (typeof body.partidas !== 'number' || !(TORNEO_PARTIDAS as readonly number[]).includes(body.partidas)) return fail(400, 'Partidas por cruce: 1 o 3');
  if (typeof body.roundDays !== 'number' || !Number.isInteger(body.roundDays) || body.roundDays < 1 || body.roundDays > 7) return fail(400, 'Días por ronda: de 1 a 7');
  const until = typeof body.signupUntil === 'string' ? Date.parse(body.signupUntil) : NaN;
  if (!Number.isFinite(until) || until <= now.getTime() || until > now.getTime() + 60 * DAY) return fail(400, 'Fecha de cierre de inscripción no válida');
  const t: Torneo = {
    id: globalThis.crypto.randomUUID(),
    name,
    createdBy: uid,
    createdAt: now.toISOString(),
    size: body.size,
    partidas: body.partidas,
    roundDays: body.roundDays,
    signupUntil: new Date(until).toISOString(),
    status: 'open',
    entries: [],
  };
  await d.torneos.put(t);
  return { ok: true, value: t };
}

const entryOf = (t: Torneo, uid: string) => t.entries.find((e) => e.a === uid || e.b === uid);

export async function signup(d: TorneoDeps, uid: string, torneoId: string, partnerId: unknown, now: Date = new Date()): Promise<Ok<Torneo> | Fail> {
  return withLock(torneoId, async () => {
    const t = await d.torneos.get(torneoId);
    if (!t) return fail(404, 'Ese torneo no existe');
    if (t.status !== 'open' || Date.parse(t.signupUntil) <= now.getTime()) return fail(409, 'La inscripción está cerrada');
    if (typeof partnerId !== 'string' || partnerId === uid) return fail(400, 'Elige a tu pareja');
    const me = (await d.users.get(uid)) as TUser | null;
    if (!me?.friends?.includes(partnerId)) return fail(400, 'Tu pareja tiene que ser amigo tuyo');
    if (entryOf(t, uid)) return fail(409, 'Ya estás apuntado a este torneo');
    if (entryOf(t, partnerId)) return fail(409, 'Tu pareja ya está apuntada con otra persona');
    if (t.entries.filter((e) => e.confirmed).length >= t.size) return fail(409, 'El torneo está completo');
    if (t.entries.length >= t.size * 3) return fail(409, 'Hay demasiadas inscripciones pendientes');
    t.entries.push({ id: globalThis.crypto.randomUUID().slice(0, 8), a: uid, b: partnerId, confirmed: false, createdAt: now.toISOString() });
    await d.torneos.put(t);
    const { name } = displayName(await d.players.get(me.primaryPlayerId).catch(() => null));
    d.notify?.(partnerId, {
      title: t.name,
      body: `${name} te ha apuntado de pareja al torneo. ¿Juegas?`,
      url: `/#torneo-${t.id}`,
      tag: `torneo-${t.id}`,
      ttl: 3 * 86_400,
    });
    return { ok: true, value: t };
  });
}

export async function confirmEntry(d: TorneoDeps, uid: string, torneoId: string, now: Date = new Date()): Promise<Ok<Torneo> | Fail> {
  return withLock(torneoId, async () => {
    const t = await d.torneos.get(torneoId);
    if (!t) return fail(404, 'Ese torneo no existe');
    if (t.status !== 'open' || Date.parse(t.signupUntil) <= now.getTime()) return fail(409, 'La inscripción está cerrada');
    const e = t.entries.find((x) => x.b === uid && !x.confirmed);
    if (!e) return fail(404, 'No tienes ninguna invitación en este torneo');
    if (t.entries.filter((x) => x.confirmed).length >= t.size) return fail(409, 'El torneo ya está completo');
    e.confirmed = true;
    await d.torneos.put(t);
    return { ok: true, value: t };
  });
}

/** Borrarse (cualquiera de los dos) o rechazar la invitación. */
export async function withdraw(d: TorneoDeps, uid: string, torneoId: string): Promise<Ok<Torneo> | Fail> {
  return withLock(torneoId, async () => {
    const t = await d.torneos.get(torneoId);
    if (!t) return fail(404, 'Ese torneo no existe');
    if (t.status !== 'open') return fail(409, 'El torneo ya ha empezado');
    const e = entryOf(t, uid);
    if (!e) return fail(404, 'No estás apuntado');
    t.entries = t.entries.filter((x) => x !== e);
    await d.torneos.put(t);
    return { ok: true, value: t };
  });
}

async function pairRating(d: TorneoDeps, e: Entry): Promise<number> {
  const r = async (uid: string) => {
    const u = await d.users.get(uid).catch(() => null);
    const p: LinkedPlayer | null = u ? await d.players.get(u.primaryPlayerId).catch(() => null) : null;
    return p?.rating ?? 1000;
  };
  return ((await r(e.a)) + (await r(e.b))) / 2;
}

async function doStart(d: TorneoDeps, t: Torneo, now: Date): Promise<Torneo> {
  const ratings = new Map<string, number>();
  for (const e of t.entries.filter((x) => x.confirmed)) ratings.set(e.id, await pairRating(d, e));
  const adv = startTorneo(t, (e) => ratings.get(e.id) ?? 1000, now);
  await d.torneos.put(t);
  if (t.status === 'running' || t.status === 'finished') await afterAdvance(d, t, adv);
  return t;
}

/** Admin: empezar ya o cancelar. */
export async function adminAction(d: TorneoDeps, uid: string, torneoId: string, action: 'start' | 'cancel', now: Date = new Date()): Promise<Ok<Torneo> | Fail> {
  if (!(await isAdmin(d, uid))) return fail(403, 'Solo un administrador');
  return withLock(torneoId, async () => {
    const t = await d.torneos.get(torneoId);
    if (!t) return fail(404, 'Ese torneo no existe');
    if (action === 'cancel') {
      if (t.status === 'finished' || t.status === 'cancelled') return fail(409, 'Ya ha terminado');
      t.status = 'cancelled';
      t.finishedAt = now.toISOString();
      await d.torneos.put(t);
      return { ok: true, value: t };
    }
    if (t.status !== 'open') return fail(409, 'Ya ha empezado');
    if (t.entries.filter((e) => e.confirmed).length < 2) return fail(409, 'Hacen falta al menos 2 parejas confirmadas');
    return { ok: true, value: await doStart(d, t, now) };
  });
}

/** Barrido: cierra inscripciones vencidas y rondas vencidas. */
export async function sweepTorneos(d: TorneoDeps, now: Date = new Date(), random: () => number = Math.random): Promise<void> {
  for (const s of await d.torneos.list(30)) {
    if (s.status === 'open' && Date.parse(s.signupUntil) <= now.getTime()) {
      await withLock(s.id, async () => {
        const t = await d.torneos.get(s.id);
        if (t && t.status === 'open') await doStart(d, t, now);
      });
    } else if (s.status === 'running') {
      await withLock(s.id, async () => {
        const t = await d.torneos.get(s.id);
        if (!t || t.status !== 'running') return;
        const before = JSON.stringify(t.rounds);
        const adv = resolveDeadlines(t, now, (code) => d.tables?.state(code) === 'playing', random);
        if (JSON.stringify(t.rounds) === before) return; // nada vencido
        await d.torneos.put(t);
        await afterAdvance(d, t, adv);
      });
    }
  }
}

/** Resultado de la mesa de un cruce (`team` 0 = pareja A en sillas 0-2). */
export async function recordTableResult(
  d: TorneoDeps,
  torneoId: string,
  matchId: string,
  team: 0 | 1,
  score: [number, number],
  now: Date = new Date(),
): Promise<boolean> {
  return withLock(torneoId, async () => {
    const t = await d.torneos.get(torneoId);
    const found = t ? findMatch(t, matchId) : null;
    if (!t || !found || found.match.winner || t.status !== 'running') return false;
    const winner = team === 0 ? found.match.a : found.match.b;
    if (!winner) return false;
    const adv = setWinner(t, matchId, winner, 'played', now, score);
    await d.torneos.put(t);
    await afterAdvance(d, t, adv);
    return true;
  });
}

/** "Ir a la mesa": crea la mesa del cruce si hace falta y reserva tu silla. */
export async function goToTable(d: TorneoDeps, uid: string, torneoId: string): Promise<Ok<{ code: string; token: string }> | Fail> {
  if (!d.tables) return fail(409, 'Mesas no disponibles');
  const tables = d.tables;
  return withLock(torneoId, async () => {
    const t = await d.torneos.get(torneoId);
    if (!t) return fail(404, 'Ese torneo no existe');
    const e = entryOf(t, uid);
    if (!e) return fail(404, 'No juegas en este torneo');
    const pending = pendingMatchOf(t, e.id);
    if (!pending) return fail(409, 'No tienes ningún cruce pendiente');
    const { r, match } = pending;
    if (!match.a || !match.b) return fail(409, 'Aún no sabéis contra quién jugáis');
    if (Date.parse(t.roundDeadlines![r]!) <= Date.now() && !(match.roomCode && tables.state(match.roomCode) === 'playing')) {
      return fail(409, 'El plazo de esta ronda ha terminado');
    }
    if (!match.roomCode || tables.state(match.roomCode) === 'none') {
      match.roomCode = tables.open(t, match, roundName(r, t.rounds!.length));
    }
    if (!match.showed.includes(e.id)) match.showed.push(e.id);
    const teamSeats: [0 | 2, 0 | 2] | [1 | 3, 1 | 3] = match.a === e.id ? [0, 2] : [1, 3];
    const seat = (e.a === uid ? teamSeats[0] : teamSeats[1]) as 0 | 1 | 2 | 3;
    const u = await d.users.get(uid);
    if (!u) return fail(404, 'Cuenta no encontrada');
    const { name } = displayName(await d.players.get(u.primaryPlayerId).catch(() => null));
    const token = tables.reserve(match.roomCode, seat, { name, playerId: u.primaryPlayerId });
    await d.torneos.put(t);
    if (!token) return fail(409, 'La mesa ya ha empezado sin ti');
    return { ok: true, value: { code: match.roomCode, token } };
  });
}

export function roundName(r: number, total: number): string {
  const fromEnd = total - 1 - r;
  return fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'Semifinales' : fromEnd === 2 ? 'Cuartos de final' : fromEnd === 3 ? 'Octavos de final' : `Ronda ${r + 1}`;
}

// ───────────── Vistas ─────────────

export interface PairView {
  id: string;
  names: string;
  confirmed: boolean;
  you: boolean;
}

async function pairViews(d: TorneoDeps, t: Torneo, uid: string | null): Promise<Map<string, PairView>> {
  const out = new Map<string, PairView>();
  for (const e of t.entries) out.set(e.id, { id: e.id, names: await pairNames(d, e), confirmed: e.confirmed, you: !!uid && (e.a === uid || e.b === uid) });
  return out;
}

export async function torneoSummary(d: TorneoDeps, t: Torneo, uid: string | null) {
  const mine = uid ? entryOf(t, uid) : undefined;
  let my: { status: 'invited' | 'waiting' | 'in'; partner: string; entryId: string } | null = null;
  if (mine && uid) {
    const partnerId = mine.a === uid ? mine.b : mine.a;
    const pu = await d.users.get(partnerId).catch(() => null);
    const partner = displayName(pu ? await d.players.get(pu.primaryPlayerId).catch(() => null) : null).name;
    my = { status: mine.confirmed ? 'in' : mine.b === uid ? 'invited' : 'waiting', partner, entryId: mine.id };
  }
  const champ = t.champion ? t.entries.find((e) => e.id === t.champion) : undefined;
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    size: t.size,
    partidas: t.partidas,
    roundDays: t.roundDays,
    signupUntil: t.signupUntil,
    pairs: t.entries.filter((e) => e.confirmed).length,
    champion: champ ? await pairNames(d, champ) : null,
    my,
  };
}

export async function torneoDetail(d: TorneoDeps, t: Torneo, uid: string | null) {
  const summary = await torneoSummary(d, t, uid);
  const pv = await pairViews(d, t, uid);
  const total = t.rounds?.length ?? 0;
  const rounds = (t.rounds ?? []).map((ms, r) => ({
    name: roundName(r, total),
    deadline: t.roundDeadlines?.[r] ?? null,
    matches: ms.map((m) => ({
      id: m.id,
      a: m.a ? (pv.get(m.a) ?? null) : null,
      b: m.b ? (pv.get(m.b) ?? null) : null,
      winner: m.winner,
      result: m.result ?? null,
      score: m.score ?? null,
    })),
  }));
  let next: { round: string; rival: string; deadline: string; live: boolean } | null = null;
  const mine = uid ? entryOf(t, uid) : undefined;
  if (mine) {
    const p = pendingMatchOf(t, mine.id);
    if (p && p.match.a && p.match.b) {
      const rivalId = p.match.a === mine.id ? p.match.b : p.match.a;
      next = {
        round: roundName(p.r, total),
        rival: pv.get(rivalId)?.names ?? '¿?',
        deadline: t.roundDeadlines![p.r]!,
        live: !!p.match.roomCode && d.tables?.state(p.match.roomCode) !== 'none',
      };
    }
  }
  const out = mine ? (t.status === 'running' && !pendingMatchOf(t, mine.id) ? true : false) : false;
  return {
    ...summary,
    entries: [...pv.values()].filter((p) => p.confirmed || p.you),
    rounds,
    next,
    eliminated: out,
    isAdmin: uid ? await isAdmin(d, uid) : false,
  };
}

// ───────────── Rutas ─────────────

export interface TorneoRouteOptions {
  sessionOf: (req: { headers: { cookie?: string | undefined } }) => Session | null;
  deps: () => TorneoDeps;
}

export function registerTorneoRoutes(app: FastifyInstance, opts: TorneoRouteOptions): void {
  type Rep = { code: (n: number) => { send: (b: unknown) => unknown } };
  const err = (reply: Rep, f: Fail) => reply.code(f.code).send({ error: f.error });

  app.get('/api/torneos', async (req) => {
    const s = opts.sessionOf(req);
    const d = opts.deps();
    const list = await d.torneos.list(20).catch(() => []);
    const order: Record<TorneoStatus, number> = { running: 0, open: 1, finished: 2, cancelled: 3 };
    const visible = list
      .filter((t) => t.status !== 'cancelled')
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
    return {
      canCreate: s ? await isAdmin(d, s.uid) : false,
      torneos: await Promise.all(visible.map((t) => torneoSummary(d, t, s?.uid ?? null))),
    };
  });

  app.post('/api/torneos', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const r = await createTorneo(opts.deps(), s.uid, (req.body ?? {}) as Record<string, unknown>);
    if (!r.ok) return err(reply, r);
    return torneoDetail(opts.deps(), r.value, s.uid);
  });

  app.get<{ Params: { id: string } }>('/api/torneos/:id', async (req, reply) => {
    const d = opts.deps();
    const t = await d.torneos.get(req.params.id);
    if (!t) return reply.code(404).send({ error: 'Ese torneo no existe' });
    return torneoDetail(d, t, opts.sessionOf(req)?.uid ?? null);
  });

  app.post<{ Params: { id: string; action: string } }>('/api/torneos/:id/:action', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para jugar torneos' });
    const d = opts.deps();
    const id = req.params.id;
    const a = req.params.action;
    if (a === 'play') {
      const r = await goToTable(d, s.uid, id);
      if (!r.ok) return err(reply, r);
      return r.value;
    }
    const r =
      a === 'signup'
        ? await signup(d, s.uid, id, (req.body as { partnerId?: unknown } | undefined)?.partnerId)
        : a === 'confirm'
          ? await confirmEntry(d, s.uid, id)
          : a === 'withdraw'
            ? await withdraw(d, s.uid, id)
            : a === 'start' || a === 'cancel'
              ? await adminAction(d, s.uid, id, a)
              : null;
    if (!r) return reply.code(404).send({ error: 'No existe' });
    if (!r.ok) return err(reply, r);
    return torneoDetail(d, r.value, s.uid);
  });
}
