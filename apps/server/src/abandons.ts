/**
 * S4-07: abandonos repetidos. 3 abandonos (con ELO) en 24 horas → 5
 * minutos sin poder buscar partida online. Mesas privadas y práctica con
 * bots siguen abiertas.
 */
export const ABANDON_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ABANDONS_FOR_BAN = 3;
export const BAN_MS = 5 * 60 * 1000;

/** Apunta un abandono: devuelve la lista de las últimas 24 h y, si toca, el fin del castigo. */
export function recordAbandon(
  previous: string[] | undefined,
  now: Date = new Date(),
): { abandons: string[]; banUntil: string | null } {
  const since = now.getTime() - ABANDON_WINDOW_MS;
  const abandons = [...(previous ?? []).filter((t) => Date.parse(t) > since), now.toISOString()];
  const banUntil = abandons.length >= ABANDONS_FOR_BAN ? new Date(now.getTime() + BAN_MS).toISOString() : null;
  return { abandons, banUntil };
}

/** Epoch ms hasta el que no puede buscar partida, o null. */
export function activeBan(banUntil: string | undefined | null, now: number = Date.now()): number | null {
  if (!banUntil) return null;
  const t = Date.parse(banUntil);
  return t > now ? t : null;
}
