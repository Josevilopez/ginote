/**
 * Matchmaking con rating. Cola en memoria + tick que forma mesas
 * (S2-11). Decisiones tomadas el 2026-10-17:
 *
 *  - **Cola con tickets `{ playerId, mode, fill, rating, enqueuedAt, ws }`**.
 *    `ws` se guarda para poder notificar al cliente cuando se le
 *    asigna una mesa (mensaje `QUEUE_MATCHED` con el código).
 *  - **Ventana de rating**: base ±100, +50 cada 5 s en cola, tope ±400.
 *  - **Formación**: ordenar por rating (a ≥ b ≥ c ≥ d), equipos
 *    `(a, d)` vs `(b, c)` — compañeros sentados enfrentados.
 *  - **Relleno con bots**: a los 10 s en cola con `fill: 'bots'`, el
 *    ticket se considera "abierto a bots": cualquier rating vale
 *    (los bots tienen rating fijo 1000). Con `humansOnly`, espera
 *    sin límite (decisión del usuario: "10 s esperando > 5 min solo").
 *  - **Bots nivel 1, rating 1000 fijo**. No afecta ELO de humanos.
 *  - **Tick cada 1 s**. Ligero: O(n²) sobre la cola (típicamente <100
 *    tickets en MVP). Si crece, índice por buckets de rating.
 */
import type { WebSocket } from 'ws';

/** Modos de juego: 4 (clásico) o 2 (cara a cara). */
export type MatchMode = 2 | 4;

/** `bots` = rellenar con bots a los 10s. `humansOnly` = solo humanos. */
export type FillPolicy = 'bots' | 'humansOnly';

export interface Ticket {
  playerId: string;
  mode: MatchMode;
  fill: FillPolicy;
  rating: number;
  enqueuedAt: number;
  /** WS del cliente. Lo guardamos para notificar cuando hay match. */
  ws: WebSocket | null;
  /** Nombre para mostrar en la UI mientras busca. */
  name: string;
}

/** Rating fijo de los bots (no se mueve con ELO). */
export const BOT_RATING = 1000;

/** Ventana inicial ±100, +50 cada 5s, tope ±400. */
export const WINDOW_BASE = 100;
export const WINDOW_STEP_MS = 5_000;
export const WINDOW_STEP = 50;
export const WINDOW_MAX = 400;

/** Si un ticket lleva >=10s con fill='bots', se rellena con bots. */
export const BOT_FILL_AFTER_MS = 10_000;

/** Calcula la ventana de rating para un ticket (en puntos). */
export function ratingWindow(t: Ticket): number {
  const elapsed = Date.now() - t.enqueuedAt;
  const steps = Math.floor(elapsed / WINDOW_STEP_MS);
  return Math.min(WINDOW_BASE + steps * WINDOW_STEP, WINDOW_MAX);
}

/** Cola en memoria. Singleton del módulo. */
const queue: Ticket[] = [];

/** Resultado de `tryFormMatch`: cuántas mesas se formaron. */
export interface FormedMatch {
  ticketIds: string[];
  ratings: number[];
}

/**
 * Intenta formar mesas con los tickets actuales. Se llama en el tick.
 * Idempotente: si no hay match, devuelve [] sin error.
 *
 * Algoritmo:
 *  1. Agrupar tickets por `mode`.
 *  2. Para cada grupo, ordenar por `enqueuedAt` (más antiguos primero).
 *  3. Para cada ticket en orden, intentar encajar con N-1 tickets
 *     compatibles (mismo mode, ventana OK, mismo fill o uno 'bots').
 *  4. Si se llena, ordenar por rating, formar equipos, emitir match.
 *
 * Devuelve la lista de matches formados (cada uno con N tickets).
 */
export function tryFormMatch(now: number = Date.now()): FormedMatch[] {
  const formed: FormedMatch[] = [];
  // Agrupar por mode
  const byMode: Record<MatchMode, Ticket[]> = { 2: [], 4: [] };
  for (const t of queue) {
    byMode[t.mode].push(t);
  }
  for (const mode of [2, 4] as MatchMode[]) {
    const group = byMode[mode];
    if (group.length < mode) continue;
    // Ordenar por enqueuedAt ascendente (más antiguos primero)
    group.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    // Greedy: el más antiguo busca N-1 compañeros compatibles.
    while (group.length >= mode) {
      const head = group[0]!;
      const compatible = findCompatible(head, group.slice(1), mode - 1, now);
      if (compatible === null) {
        // El más antiguo no encuentra match: descartarlo del grupo (no
        // del queue). Así no bloqueamos al resto. Al siguiente tick
        // vuelve a intentarlo si su ventana ha crecido.
        group.shift();
        continue;
      }
      const picked = [head, ...compatible];
      // Quitar del queue
      for (const t of picked) {
        const idx = queue.indexOf(t);
        if (idx >= 0) queue.splice(idx, 1);
      }
      // Quitar del grupo
      for (const t of picked) {
        const gIdx = group.indexOf(t);
        if (gIdx >= 0) group.splice(gIdx, 1);
      }
      formed.push({
        ticketIds: picked.map((t) => t.playerId),
        ratings: picked.map((t) => t.rating),
      });
    }
  }
  return formed;
}

/**
 * Busca `need` tickets compatibles con `head`. Devuelve null si no hay.
 *
 * Compatibilidad:
 *  - rating dentro de la ventana del head (o el head dentro de la
 *    ventana del candidato, para que la decisión sea simétrica si
 *    entraron en momentos distintos).
 *  - mismo `fill`. Si head es `bots`, candidatos pueden ser `humansOnly`
 *    pero el grupo se vuelve `bots` (segun el primero).
 *  - `humansOnly`: el candidato debe ser humano (no-bot). Si el head
 *    lleva >= BOT_FILL_AFTER_MS y su fill es `bots`, se acepta cualquiera
 *    y los huecos se rellenarán con bots después.
 */
function findCompatible(
  head: Ticket,
  pool: Ticket[],
  need: number,
  now: number,
): Ticket[] | null {
  const headWindow = ratingWindow(head);
  const headAcceptsBots = head.fill === 'bots' && now - head.enqueuedAt >= BOT_FILL_AFTER_MS;

  // Filtrar candidatos compatibles
  const compatible = pool.filter((c) => {
    // Rating dentro de la ventana del head
    const winC = ratingWindow(c);
    const ratingOk =
      Math.abs(c.rating - head.rating) <= Math.max(headWindow, winC);
    if (!ratingOk) return false;
    // humansOnly: rechazar candidatos que lleven mucho esperando con bots
    if (c.fill === 'humansOnly' && !headAcceptsBots && head.fill === 'bots') {
      // head quiere bots pero el candidato solo humanos → no encajan
      return false;
    }
    if (head.fill === 'humansOnly' && c.fill === 'bots') {
      // head solo humanos, candidato acepta bots → no encajan
      return false;
    }
    return true;
  });

  if (compatible.length < need) return null;

  // Empezar por los más próximos en rating al head (encaje más natural).
  // Si hay empate, por más antiguos (enqueuedAt ascendente).
  compatible.sort((a, b) => {
    const da = Math.abs(a.rating - head.rating);
    const db = Math.abs(b.rating - head.rating);
    if (da !== db) return da - db;
    return a.enqueuedAt - b.enqueuedAt;
  });

  return compatible.slice(0, need);
}

/** Añade un ticket a la cola. Devuelve el ticket añadido. */
export function enqueue(t: Ticket): Ticket {
  queue.push(t);
  return t;
}

/** Quita un ticket de la cola por playerId. */
export function dequeue(playerId: string): boolean {
  const idx = queue.findIndex((t) => t.playerId === playerId);
  if (idx < 0) return false;
  queue.splice(idx, 1);
  return true;
}

/** Snapshot de la cola (solo lectura). */
export function listQueue(): readonly Ticket[] {
  return queue;
}

/** ¿El ticket sigue en cola? */
export function isInQueue(playerId: string): boolean {
  return queue.some((t) => t.playerId === playerId);
}

/** Tamaño actual de la cola. */
export function queueSize(): number {
  return queue.length;
}