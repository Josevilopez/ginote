/**
 * S4-08: nombres que ven los demás (mesa, pareja, cola, ranking). Si es
 * ofensivo, se cambia por "Jugador"; la web avisa antes de guardarlo.
 */
import { isOffensiveName } from '@guinote/protocol';

export const DEFAULT_NAME = 'Jugador';

export function safeName(raw: unknown, max = 20): string {
  const s = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!s || isOffensiveName(s)) return DEFAULT_NAME;
  return s;
}
