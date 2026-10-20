/**
 * S3-05: cola de "Jugar online" por nivel (rating ELO).
 *
 * En la cola hay **entradas**: un jugador suelto o una pareja (S3-04).
 * Cada segundo el servidor intenta formar mesas de 4:
 *
 *  - **Ventana de nivel**: ±100 puntos al entrar, +50 cada 5 s, tope ±400.
 *    Dos entradas encajan si su diferencia cabe en la ventana del que
 *    más lleva esperando.
 *  - **Mesa completa de humanos** si hay entradas compatibles que sumen 4
 *    (2+2, 2+1+1, 1+1+1+1). Empieza por el que más lleva esperando.
 *  - **Bots de relleno**: si el más antiguo lleva `BOT_FILL_AFTER_MS` sin
 *    mesa completa, se forma con los humanos que haya buscando **sea cual
 *    sea su nivel** (mejor un rival más fuerte que un bot; el nivel solo
 *    decide entre humanos cuando hay donde elegir) y el resto bots, con
 *    nivel según el rating medio de la mesa.
 *  - **Asientos**: una pareja ocupa un equipo entero (0-2 o 1-3). Los
 *    sueltos se reparten para equilibrar: con 4, el mejor con el peor.
 *
 * Funciones puras sobre la cola; el tick y la creación de la sala viven
 * en `index.ts`.
 */
import type { Seat } from '@guinote/engine';
import type { BotLevel } from '@guinote/bots';

export interface QueueMember {
  playerId: string | null;
  name: string;
  rating: number;
}

export interface QueueEntry {
  id: string;
  members: QueueMember[];
  enqueuedAt: number;
  /** S3-04: código de la pareja, si la entrada es una pareja. */
  partyCode?: string;
  /** Avisar a la entrada de su mesa: un token de asiento por miembro (mismo orden). */
  notify: (match: { roomCode: string; seats: Seat[]; tokens: string[] }) => void;
}

/** Ventana inicial ±100, +50 cada 5 s, tope ±400. */
export const WINDOW_BASE = 100;
export const WINDOW_STEP_MS = 5_000;
export const WINDOW_STEP = 50;
export const WINDOW_MAX = 400;
/** Sin mesa completa en este tiempo → se completa con bots. */
export const BOT_FILL_AFTER_MS = 20_000;
/** Por debajo de este rating medio, bots fáciles; si no, normales. */
export const EASY_BOTS_BELOW = 950;

const queue: QueueEntry[] = [];

export function entryRating(e: QueueEntry): number {
  return e.members.reduce((a, m) => a + m.rating, 0) / e.members.length;
}

export function ratingWindow(e: QueueEntry, now: number = Date.now()): number {
  const steps = Math.floor(Math.max(0, now - e.enqueuedAt) / WINDOW_STEP_MS);
  return Math.min(WINDOW_BASE + steps * WINDOW_STEP, WINDOW_MAX);
}

export function compatible(a: QueueEntry, b: QueueEntry, now: number = Date.now()): boolean {
  return Math.abs(entryRating(a) - entryRating(b)) <= Math.max(ratingWindow(a, now), ratingWindow(b, now));
}

export function enqueue(e: QueueEntry): QueueEntry {
  dequeue(e.id);
  queue.push(e);
  return e;
}

export function dequeue(id: string): boolean {
  const i = queue.findIndex((e) => e.id === id);
  if (i < 0) return false;
  queue.splice(i, 1);
  return true;
}

export function listQueue(): readonly QueueEntry[] {
  return queue;
}

export function isInQueue(id: string): boolean {
  return queue.some((e) => e.id === id);
}

/** Jugadores (no entradas) buscando partida ahora mismo. */
export function playersSearching(): number {
  return queue.reduce((n, e) => n + e.members.length, 0);
}

/** Para tests. */
export function _clearQueue(): void {
  queue.length = 0;
}

export interface FormedTable {
  entries: QueueEntry[];
  /** Asiento de cada miembro de cada entrada (mismo orden que `entries`). */
  seats: Seat[][];
  bots: number;
  botLevel: BotLevel;
}

/** Subconjunto de `pool` (en su orden de preferencia) cuyos tamaños suman `need`. */
function pickExact(pool: QueueEntry[], need: number): QueueEntry[] | null {
  const limit = Math.min(pool.length, 12);
  const pick: QueueEntry[] = [];
  const dfs = (i: number, left: number): boolean => {
    if (left === 0) return true;
    for (let j = i; j < limit; j++) {
      const e = pool[j]!;
      if (e.members.length > left) continue;
      pick.push(e);
      if (dfs(j + 1, left - e.members.length)) return true;
      pick.pop();
    }
    return false;
  };
  return dfs(0, need) ? pick : null;
}

/** Los que quepan, en orden de preferencia, hasta llenar `room` plazas. */
function pickGreedy(pool: QueueEntry[], room: number): QueueEntry[] {
  const pick: QueueEntry[] = [];
  let left = room;
  for (const e of pool) {
    if (e.members.length <= left) {
      pick.push(e);
      left -= e.members.length;
    }
    if (left === 0) break;
  }
  return pick;
}

export function botLevelFor(entries: QueueEntry[]): BotLevel {
  const ratings = entries.flatMap((e) => e.members.map((m) => m.rating));
  const avg = ratings.reduce((a, r) => a + r, 0) / Math.max(1, ratings.length);
  return avg < EASY_BOTS_BELOW ? 1 : 2;
}

/**
 * Asientos para una mesa. Equipos: 0-2 y 1-3.
 *  - Parejas: cada una un equipo entero.
 *  - Sueltos ordenados por rating (a ≥ b ≥ c ≥ d):
 *      4 → a,d (0-2) contra b,c (1-3)
 *      3 → a + bot contra b,c
 *      2 → uno en cada equipo (a 0, b 1), con bots de compañeros
 *      1 → asiento 0
 *  - Pareja + sueltos: la pareja 0-2, los sueltos 1-3.
 */
export function seatTable(entries: QueueEntry[]): Seat[][] {
  const seats: Seat[][] = entries.map((e) => new Array<Seat>(e.members.length));
  const pairs = entries.map((e, i) => ({ e, i })).filter((x) => x.e.members.length === 2);
  const singles = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.members.length === 1)
    .sort((x, y) => entryRating(y.e) - entryRating(x.e));
  const teams: [Seat, Seat][] = [
    [0, 2],
    [1, 3],
  ];
  pairs.forEach((p, k) => {
    seats[p.i] = [...teams[k]!];
  });
  let order: Seat[];
  if (pairs.length === 1) order = [1, 3];
  else if (singles.length === 4) order = [0, 1, 3, 2];
  else if (singles.length === 3) order = [0, 1, 3];
  else order = [0, 1];
  singles.forEach((s, k) => {
    seats[s.i] = [order[k]!];
  });
  return seats;
}

/**
 * Forma todas las mesas posibles ahora y saca sus entradas de la cola.
 * Idempotente: si no hay nada que formar, devuelve [].
 */
export function formTables(now: number = Date.now()): FormedTable[] {
  const tables: FormedTable[] = [];
  const pending = queue.slice().sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  const used = new Set<string>();
  for (const head of pending) {
    if (used.has(head.id)) continue;
    const pool = pending
      .filter((c) => c !== head && !used.has(c.id) && compatible(head, c, now))
      .sort((a, b) => {
        const da = Math.abs(entryRating(a) - entryRating(head));
        const db = Math.abs(entryRating(b) - entryRating(head));
        return da !== db ? da - db : a.enqueuedAt - b.enqueuedAt;
      });
    const need = 4 - head.members.length;
    let picked = pickExact(pool, need);
    let bots = 0;
    if (!picked) {
      if (now - head.enqueuedAt < BOT_FILL_AFTER_MS) continue;
      // Tocan bots: antes, cualquier humano que esté buscando, aunque su
      // nivel quede fuera de la ventana. Los más cercanos primero.
      const anyone = pending
        .filter((c) => c !== head && !used.has(c.id))
        .sort((a, b) => {
          const da = Math.abs(entryRating(a) - entryRating(head));
          const db = Math.abs(entryRating(b) - entryRating(head));
          return da !== db ? da - db : a.enqueuedAt - b.enqueuedAt;
        });
      picked = pickExact(anyone, need) ?? pickGreedy(anyone, need);
      bots = need - picked.reduce((n, e) => n + e.members.length, 0);
    }
    const entries = [head, ...picked];
    for (const e of entries) used.add(e.id);
    tables.push({ entries, seats: seatTable(entries), bots, botLevel: botLevelFor(entries) });
  }
  for (const t of tables) for (const e of t.entries) dequeue(e.id);
  return tables;
}
