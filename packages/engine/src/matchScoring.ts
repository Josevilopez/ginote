import type { GameState, NewHandOptions } from './state.js';
import { nextDealer } from './rules.js';
import type { Seat, Team } from './types.js';

/**
 * S2-06 — Puntuación del MATCH (por encima de la partida).
 *
 * Niveles del guiñote online (decisión 2026-10-17, S2-13):
 *  - **Mano**: reparto + bazas. La gestiona `apply`.
 *  - **Partida**: idas + vueltas hasta que un equipo pasa del umbral
 *    (`rules.scoring.threshold`, 100). La cierra el motor en `apply`
 *    (`state.matchEnded` / `state.matchWinner`; el nombre "match" en el
 *    estado es histórico: significa "partida").
 *  - **Match**: varias partidas seguidas con revancha; gana el primero
 *    en llegar a N partidas (3). Antes vivía en el server (`room.ts`);
 *    ahora la regla está aquí y el server solo guarda el contador y
 *    gestiona votos/temporizadores.
 *
 * Interfaz para poder cambiar el formato sin tocar el server (p. ej. los
 * "cotos" de las partidas privadas de Sprint 3+, o "al mejor de 5").
 * Implementación pura e inmutable: cada operación devuelve un objeto nuevo.
 */
export type MatchWins = Readonly<Record<Team, number>>;

export interface MatchScoring {
  /** Identificador legible del formato (logs, snapshots). */
  readonly id: string;
  /** Partidas necesarias para ganar el match. */
  readonly winsToWin: number;
  /** Marcador inicial (0-0). */
  start(): Record<Team, number>;
  /** Marcador tras sumar una partida ganada por `winner`. */
  recordPartida(wins: MatchWins, winner: Team): Record<Team, number>;
  /** Equipo que ya ha ganado el match, o `null` si sigue abierto. */
  champion(wins: MatchWins): Team | null;
  /**
   * Quién va por delante si el match se cierra antes de tiempo (rechazo
   * de revancha, timeout, abandono). `null` = empate.
   */
  leader(wins: MatchWins): Team | null;
}

/** "Primero en llegar a N partidas". */
export function firstToN(n: number): MatchScoring {
  if (!Number.isInteger(n) || n < 1) throw new Error(`firstToN: n inválido (${n})`);
  return {
    id: `first-to-${n}`,
    winsToWin: n,
    start: () => ({ 0: 0, 1: 0 }),
    recordPartida: (wins, winner) => ({ ...wins, [winner]: wins[winner] + 1 }) as Record<Team, number>,
    champion: (wins) => (wins[0] >= n ? 0 : wins[1] >= n ? 1 : null),
    leader: (wins) => (wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : null),
  };
}

/** Formato de las partidas rápidas (S2-13): primero a 3 partidas. */
export const FIRST_TO_3: MatchScoring = firstToN(3);

/**
 * Parámetros de la mano SIGUIENTE a `prev` (que debe estar en `finished`):
 *  - Dealer: "el que corta, reparte" (ganador de la última baza).
 *  - Si `prev` cerró la partida → partida nueva: vuelta 1 y marcadores
 *    (buenas/malas y puntos acumulados) a cero.
 *  - Si no → misma partida: vuelta + 1 y se arrastran los marcadores.
 *
 * Antes esta lógica estaba copiada en el server (`startNextHand`) y en los
 * tests; ahora es una sola.
 */
export function nextHandSetup(prev: GameState): {
  dealer: Seat;
  continuation: NonNullable<NewHandOptions['continuation']>;
} {
  const lastTrick = prev.finishedTricks[prev.finishedTricks.length - 1];
  const dealer = nextDealer(lastTrick ? lastTrick.winner : null, prev.dealer);
  const newPartida = prev.matchEnded;
  return {
    dealer,
    continuation: {
      vuelta: newPartida ? 1 : prev.vuelta + 1,
      score: newPartida ? { buenas: { 0: 0, 1: 0 }, malas: { 0: 0, 1: 0 } } : prev.score,
      cumulativeTeamPts: newPartida ? { 0: 0, 1: 0 } : prev.cumulativeTeamPts,
      matchEnded: false,
      matchWinner: null,
    },
  };
}

// ─────────────── S3-07: formato coto / match ───────────────

/**
 * Formato de una mesa (confirmado 2026-10-19):
 *  - **Coto**: lo gana quien gana `partidasPorCoto` partidas (3).
 *  - **Match**: lo gana quien gana `cotosParaGanar` cotos (2 = al mejor de 3).
 * La partida rápida es 1 coto (`QUICK_FORMAT`). En mesas privadas el
 * anfitrión elige, porque las reglas cambian según el pueblo.
 */
export interface MatchFormat {
  readonly partidasPorCoto: number;
  readonly cotosParaGanar: number;
}

export const QUICK_FORMAT: MatchFormat = { partidasPorCoto: 3, cotosParaGanar: 1 };
export const COTO_MATCH_FORMAT: MatchFormat = { partidasPorCoto: 3, cotosParaGanar: 2 };

/** Límites razonables para lo que puede elegir el anfitrión. */
export const FORMAT_LIMITS = { partidasPorCoto: [1, 5], cotosParaGanar: [1, 3] } as const;

export function isValidFormat(f: MatchFormat): boolean {
  const [pMin, pMax] = FORMAT_LIMITS.partidasPorCoto;
  const [cMin, cMax] = FORMAT_LIMITS.cotosParaGanar;
  return (
    Number.isInteger(f.partidasPorCoto) && f.partidasPorCoto >= pMin && f.partidasPorCoto <= pMax &&
    Number.isInteger(f.cotosParaGanar) && f.cotosParaGanar >= cMin && f.cotosParaGanar <= cMax
  );
}

/** Marcador de una mesa: partidas del coto en curso y cotos ganados. */
export interface MatchProgress {
  readonly partidas: Record<Team, number>;
  readonly cotos: Record<Team, number>;
}

export function startProgress(): MatchProgress {
  return { partidas: { 0: 0, 1: 0 }, cotos: { 0: 0, 1: 0 } };
}

/**
 * Suma una partida ganada por `winner`.
 *  - Si con ella gana el coto: `cotoWinner = winner` y suma un coto.
 *  - Si además gana el match: `matchWinner = winner`; el marcador de
 *    partidas se queda como acabó (para enseñarlo, p. ej. 3-1).
 *  - Si gana el coto pero no el match: las partidas vuelven a 0-0
 *    (empieza el coto siguiente).
 * Puro: devuelve un marcador nuevo.
 */
export function recordPartidaResult(
  p: MatchProgress,
  winner: Team,
  f: MatchFormat,
): { progress: MatchProgress; cotoWinner: Team | null; matchWinner: Team | null } {
  const partidas = { ...p.partidas, [winner]: p.partidas[winner] + 1 } as Record<Team, number>;
  if (partidas[winner] < f.partidasPorCoto) {
    return { progress: { partidas, cotos: { ...p.cotos } }, cotoWinner: null, matchWinner: null };
  }
  const cotos = { ...p.cotos, [winner]: p.cotos[winner] + 1 } as Record<Team, number>;
  if (cotos[winner] >= f.cotosParaGanar) {
    return { progress: { partidas, cotos }, cotoWinner: winner, matchWinner: winner };
  }
  return { progress: { partidas: { 0: 0, 1: 0 }, cotos }, cotoWinner: winner, matchWinner: null };
}

/** Quién va por delante (cotos y, a igualdad, partidas). `null` = empate. */
export function progressLeader(p: MatchProgress): Team | null {
  if (p.cotos[0] !== p.cotos[1]) return p.cotos[0] > p.cotos[1] ? 0 : 1;
  if (p.partidas[0] !== p.partidas[1]) return p.partidas[0] > p.partidas[1] ? 0 : 1;
  return null;
}
