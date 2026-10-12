import type { Card, Rank, Seat } from './types.js';

/**
 * Ranks del triunfo que SÍ permiten cambiar el 7 (carta superior a 7 en
 * el orden de fuerza del guiñote aragonés). Si el triunfo visible es de
 * otro rango (2, 4, 5, 6, 7), el cambio NO procede — no tiene sentido
 * soltar el 7 (que captura la baza) a cambio de una carta peor.
 */
export const SWAP_ELIGIBLE_RANKS: ReadonlySet<Rank> = new Set<Rank>([
  1, 3, 10, 11, 12,
]);

/** ¿La carta de triunfo visible permite hacer el cambio del 7? */
export function canSwapSevenWithTrump(trumpCard: Card | null): boolean {
  return trumpCard !== null && SWAP_ELIGIBLE_RANKS.has(trumpCard.rank);
}

/**
 * Regla del guiñote aragonés para el dealer de la siguiente mano: el
 * ganador de la última baza de la mano que acaba de terminar (regla típica
 * de "el que corta, reparte"). Se aplica a TODAS las transiciones entre
 * manos (idas → vueltas y dentro de vueltas), no rota.
 *
 * Si por alguna razón no hay última baza registrada (no debería ocurrir en
 * juego real porque cada mano tiene 10 trucos), `fallbackDealer` se usa
 * como red de seguridad.
 */
export function nextDealer(lastTrickWinner: Seat | null, fallbackDealer: Seat): Seat {
  return lastTrickWinner ?? fallbackDealer;
}

/**
 * Configuración de reglas. La idea es que motor y tests carguen una `RulesConfig`
 * y todo el comportamiento se derive de ella. Más adelante, si hay variantes
 * regionales, se añade una `GUINOTE_OTRA` y se elige en el arranque de la sala.
 *
 * Los flags marcados con `// TODO(decision)` son decisiones pendientes confirmadas
 * con valores por defecto; revisar antes de subir a producción.
 */
export interface RulesConfig {
  readonly players: 2 | 4;
  readonly handSize: number;
  readonly dealBatch: number;

  /** Puntos por rango de carta. Las cartas sin entrada valen 0. */
  readonly cardPoints: Partial<Record<Rank, number>>;

  /** Fuerza de las cartas de más fuerte (índice 0) a más débil. */
  readonly strength: readonly Rank[];

  /** Puntos extra por ganar la última baza (10 de últimas). */
  readonly lastTrickBonus: number;

  readonly dealerRotation: 'next';
  readonly firstLeader: 'afterDealer';

  readonly draw: {
    readonly winnerDrawsFirst: boolean;
    readonly lastCardIsTrump: boolean;
  };

  readonly arrastre: {
    readonly mustFollowSuit: boolean;
    readonly mustOverplay: boolean;
    readonly mustTrumpIfVoid: boolean;
    /** Si el compañero va ganando la baza, no estás obligado a superar. */
    readonly partnerWinningExemptsOverplay: boolean;
    /** Si el compañero va ganando la baza, no estás obligado a fallar con triunfo
     *  (puedes descartar). Confirmado por el jugador: regla del guiñote aragonés. */
    readonly partnerWinningExemptsTrump: boolean;
    /** Si tienes triunfo pero no supera al de mesa, ¿estás obligado a tirarlo? */
    readonly mustTrumpEvenIfCantBeat: boolean;
  };

  readonly swapSeven: {
    readonly onlyOnOwnTurn: boolean;
    readonly onlyIfWonLastTrick: boolean;
    /** El cambio del 7 solo se permite en fase de robo (no en arrastre). */
    readonly onlyDuringDraw: boolean;
    readonly aloud: boolean;
  };

  readonly cantes: {
    /** Par de figuras que suman cante: Sota (10) y Rey (12). */
    readonly pair: readonly [Rank, Rank];
    /** Puntos del cante en palo normal. */
    readonly value: number;
    /** Puntos del cante cuando el par es del palo de triunfo. */
    readonly trumpValue: number;
    /** El compañero del ganador de la baza también puede cantar. */
    readonly teamMayDeclare: boolean;
    /** Se puede cantar durante el arrastre. */
    readonly allowedInArrastre: boolean;
    /** El cante lo canta quien ganó la baza o su compañero. */
    readonly requireTrickWonByTeam: boolean;
  };

  /** Puntuación de la partida a varias vueltas. `null` = mano suelta. */
  readonly scoring: VueltasScoring | null;
}

/**
 * Sistema de puntuación por vueltas (guiñote aragonés):
 *
 * Decisión de diseño: NO se gestionan contadores separados de "Buenas" y
 * "Malas" en el motor — el motor solo suma `state.cumulativeTeamPts` (raw
 * puntos de cartas + cantes + 10 de últimas). La partida termina cuando
 * un equipo cruza `threshold` puntos raw. La noción de "Buenas / Malas"
 * es PURAMENTE presentación: el cliente pinta rojo/negro en función de
 * `cumulativeTeamPts > threshold`, y MATCH_OVER dispara con el mismo
 * corte. Eso elimina el lío de gestionar dos contadores paralelos y
 * mantiene el estado del juego simple.
 *
 * Ejemplo con threshold = 100 sobre `cumulativeTeamPts` (la pantalla
 * pinta como "Malas" lo que esté ≤ 100 y como "Buenas" lo que esté >):
 *  - Vuelta 1 (idas): A suma 70, B suma 30 → cumulative { A: 70, B: 30 }.
 *    No se llega a >100 → se juega vueltas.
 *  - Vuelta 2: A suma 80, B suma 20 → cumulative { A: 150, B: 50 }.
 *    A > 100 → MATCH_OVER: A gana.
 */
export interface VueltasScoring {
  readonly mode: 'vueltas';
  /** Umbral raw: un equipo gana cuando su `cumulativeTeamPts > threshold`. */
  readonly threshold: number;
}

/**
 * Reglas confirmadas del guiñote aragonés. Ver `docs/guinote-aragones-diseno.md`.
 *
 * Confirmados:
 *  - `mustTrumpIfVoid = true`             → sin palo y rival gana: debes fallar con triunfo si puedes.
 *  - `partnerWinningExemptsOverplay = true` → compañero ganando exime de superar.
 *  - `partnerWinningExemptsTrump = true`    → compañero ganando exime de fallar con triunfo.
 *  - `mustTrumpEvenIfCantBeat = false`      → si tu triunfo NO supera al de mesa, puedes descartar
 *                                            (no estás obligado a tirar el triunfo flojo).
 *
 * El resto de flags son TODO y se ajustarán cuando confirmes.
 */
export const GUINOTE_ARAGONES: RulesConfig = {
  players: 4,
  handSize: 6,
  dealBatch: 3,
  cardPoints: { 1: 11, 3: 10, 12: 4, 10: 3, 11: 2 },
  strength: [1, 3, 12, 10, 11, 7, 6, 5, 4, 2],
  lastTrickBonus: 10,
  dealerRotation: 'next',
  firstLeader: 'afterDealer',
  draw: { winnerDrawsFirst: true, lastCardIsTrump: true },
  arrastre: {
    mustFollowSuit: true,
    mustOverplay: true,
    mustTrumpIfVoid: true,
    partnerWinningExemptsOverplay: true,
    partnerWinningExemptsTrump: true, // confirmado: compañero ganando exime de fallar con triunfo
    mustTrumpEvenIfCantBeat: false, // confirmado: si no puedes superar al triunfo de mesa, NO estás obligado a tirar triunfo (puedes descartar)
  },
  swapSeven: { onlyOnOwnTurn: true, onlyIfWonLastTrick: true, onlyDuringDraw: true, aloud: true },
  cantes: {
    pair: [10, 12],
    value: 20,
    trumpValue: 40,
    teamMayDeclare: true,
    allowedInArrastre: true,
    requireTrickWonByTeam: true,
  },
  scoring: { mode: 'vueltas', threshold: 100 },
};
