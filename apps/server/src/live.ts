/**
 * Jugadores conectados ahora mismo (para la portada).
 *
 * Una sola cifra: personas distintas que, en el último minuto, han usado la
 * web (cualquier `/api`) o tienen un WebSocket abierto en una mesa o en la
 * cola. Sin nombres. Por debajo de `LIVE_MIN` no se publica la cifra (un
 * "2 conectados" da sensación de sitio vacío).
 *
 * Vive en memoria: es exacto mientras haya una sola réplica (como las mesas).
 */

export const LIVE_WINDOW_MS = 60_000;
export const LIVE_MIN = 8;
export const LIVE_CACHE_MS = 10_000;

export class Visitors {
  private readonly seen = new Map<string, number>();
  touch(key: string, now: number = Date.now()): void {
    this.seen.set(key, now);
  }
  /** Claves vistas en la ventana (y limpia las viejas). */
  active(now: number = Date.now()): Set<string> {
    const out = new Set<string>();
    for (const [k, t] of this.seen) {
      if (now - t <= LIVE_WINDOW_MS) out.add(k);
      else this.seen.delete(k);
    }
    return out;
  }
}

/** Cuántas personas distintas: visitantes recientes ∪ conectados ahora. */
export function countLive(recent: Iterable<string>, connected: Iterable<string>): number {
  const all = new Set<string>(recent);
  for (const k of connected) all.add(k);
  return all.size;
}

/** Lo que ve la web: la cifra, o null si no llega al mínimo. */
export function publicLive(n: number, min: number = LIVE_MIN): { players: number | null } {
  return { players: n >= min ? n : null };
}

/** Caché simple: recalcula como mucho cada `ttlMs`. */
export function cached<T>(fn: () => T, ttlMs: number = LIVE_CACHE_MS): () => T {
  let at = -Infinity;
  let value: T;
  return () => {
    const now = Date.now();
    if (now - at >= ttlMs) {
      value = fn();
      at = now;
    }
    return value!;
  };
}
