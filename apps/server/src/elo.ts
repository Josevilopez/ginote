/**
 * Cálculo ELO. Lógica pura, sin I/O ni dependencias de Cosmos.
 * Testeable en aislamiento.
 *
 * Decisiones de diseño (Sprint 2-17, 2026-10-17):
 *  - **Aplicado a nivel de equipo**, no individual. Los 2 humanos de un
 *    mismo equipo comparten el `delta` calculado sobre el rating medio
 *    del equipo. Más simple que gestionar delta individual.
 *  - **K alto (40) para nuevos** (games < 10), **K bajo (20) para
 *    establecidos** (games >= 10). Decisión del plan original.
 *  - **Rating inicial 1000**. La pareja debate entre 1000 y 1200, nos
 *    quedamos en 1000 (estándar de facto en ELO).
 *  - **Partidas con bots no cuentan para ELO**. Cuando un equipo es de
 *    bots, el caller debe omitir la llamada a `applyElo` (la lógica de
 *    cuándo contar está en `room.ts`, no aquí).
 *
 * Fórmula estándar:
 *   expected = 1 / (1 + 10^((rB - rA) / 400))
 *   newRatingA = rA + K * (score - expected)
 */

export const INITIAL_RATING = 1000;
export const K_NEW = 40;
export const K_ESTABLISHED = 20;
/**
 * Umbral a partir del cual el jugador pasa de K_NEW (40) a
 * K_ESTABLISHED (20). Decisión del plan original.
 */
export const NEW_PLAYER_GAMES_THRESHOLD = 10;

/**
 * Probabilidad esperada de que A gane dado su rating y el de B.
 * Sale del cálculo ELO clásico: probabilidad logística de la diferencia.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * K dinámico: nuevo si `gamesA < NEW_PLAYER_GAMES_THRESHOLD`,
 * establecido en caso contrario.
 */
export function kFor(gamesA: number): number {
  return gamesA < NEW_PLAYER_GAMES_THRESHOLD ? K_NEW : K_ESTABLISHED;
}

/**
 * Aplica ELO a un partido individual entre A y B.
 *
 * @param ratingA rating actual de A (o del equipo A, si se opera a nivel de equipo)
 * @param ratingB rating actual de B (o del equipo B)
 * @param scoreA 1 si A ganó, 0.5 si empate, 0 si A perdió
 * @param gamesA partidas jugadas por A hasta ahora (para K dinámico)
 */
export function applyElo(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  gamesA: number,
): { newRatingA: number; deltaA: number; expectedA: number; k: number } {
  const k = kFor(gamesA);
  const expectedA = expectedScore(ratingA, ratingB);
  const deltaA = Math.round(k * (scoreA - expectedA));
  return { newRatingA: ratingA + deltaA, deltaA, expectedA, k };
}

/**
 * Aplica ELO a un partido entre dos equipos. Cada equipo tiene un
 * rating (medio) y un número de partidas jugadas. Devuelve los nuevos
 * ratings y deltas para los dos. Por simetría, el delta de B es el
 * opuesto al de A.
 *
 * @param ratingA rating del equipo A (medio de sus 2 humanos)
 * @param ratingB rating del equipo B
 * @param scoreA  1 si A ganó, 0.5 si empate, 0 si perdió
 * @param gamesA  partidas jugadas por el equipo A (medio)
 * @param gamesB  partidas jugadas por el equipo B (medio)
 */
export function applyEloTeam(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  gamesA: number,
  gamesB: number,
): { newRatingA: number; newRatingB: number; deltaA: number; deltaB: number } {
  const a = applyElo(ratingA, ratingB, scoreA, gamesA);
  // Para B: scoreB = 1 - scoreA, K = K de B
  const kB = kFor(gamesB);
  const expectedB = 1 - a.expectedA;
  const deltaB = Math.round(kB * (1 - scoreA - expectedB));
  return {
    newRatingA: a.newRatingA,
    newRatingB: ratingB + deltaB,
    deltaA: a.deltaA,
    deltaB,
  };
}