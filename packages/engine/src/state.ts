import type { Card, Seat, Suit } from './types.js';
import { SUITS } from './types.js';
import type { RulesConfig } from './rules.js';
import { buildShuffledDeck } from './deck.js';
import { rngFromSeed, type Rng } from './shuffle.js';

/**
 * Fases de la máquina de estados de una mano.
 *  - `deal`: tras repartir, antes de la primera salida (estado efímero, dura 0 acciones).
 *  - `lead`: alguien está saliendo (trick.plays.length === 0).
 *  - `follow`: ya salió la primera carta; los demás responden.
 *  - `winnerWindow`: ventana del ganador de la baza resuelta (cante / cambio 7 / pass).
 *  - `draw`: fase de robo (antes de la última carta).
 *  - `arrastre`: fase de arrastre (después de robarse la última carta).
 *  - `finished`: mano terminada, esperando reset.
 */
export type Phase = 'deal' | 'lead' | 'follow' | 'winnerWindow' | 'draw' | 'arrastre' | 'finished';

export interface Play {
  readonly seat: Seat;
  readonly card: Card;
}

export interface Trick {
  readonly plays: readonly Play[];
}

export interface FinishedTrick {
  readonly winner: Seat;
  readonly plays: readonly Play[];
  readonly trickPoints: number; // puntos de las cartas de la baza
  readonly hadLastTrick: boolean; // si era la última baza (para sumar 10 de últimas)
}

export interface Cante {
  /** Asiento que cantó (necesario para anunciar "Bot X canta Y"). */
  readonly seat: Seat;
  readonly team: 0 | 1;
  readonly suit: Suit;
  readonly pair: readonly [number, number];
  readonly value: number;
}

/**
 * Puntuación acumulada de la partida de vueltas.
 *  - `buenas[team]`: puntos ganados cuando el equipo tiene > 50 en una vuelta
 *    (se suma `puntos - 50` por vuelta ganada).
 *  - `malas[team]`: puntos perdidos cuando el equipo tiene ≤ 50 en una vuelta
 *    (se suma `puntos` por vuelta perdida).
 *
 * La partida termina cuando un equipo tiene AMBAS cuentas > `rules.scoring.threshold`.
 */
export interface PartidaScore {
  readonly buenas: Record<0 | 1, number>;
  readonly malas: Record<0 | 1, number>;
}

export interface GameState {
  readonly id: string;
  readonly seed: string;
  version: number;

  readonly rules: RulesConfig;
  phase: Phase;

  /** Quién reparte esta mano. */
  dealer: Seat;
  /** A quién le toca actuar (en ventanas y turnos). */
  turn: Seat | null;
  /** Quien sale / lider de la baza actual. */
  leader: Seat;

  trump: Suit;
  /** Carta de triunfo visible (la última del mazo). `null` durante arrastre. */
  trumpCard: Card | null;

  /** Mazo restante (se roba del final). Vacío al entrar en arrastre. */
  deck: Card[];

  hands: Record<Seat, Card[]>;
  trick: Trick;
  finishedTricks: FinishedTrick[];

  trickPoints: Record<0 | 1, number>;
  cantes: Cante[];

  /** Ganador de la baza anterior. `null` al principio. */
  lastWinner: Seat | null;

  /** Baza resuelta pendiente de asignar puntos (para no perder el valor 10 de últimas). */
  pendingLastTrick: boolean;

  // ─── Estado de la partida de vueltas ────────────────────────────────────
  /** Número de vuelta (1, 2, ...). */
  vuelta: number;
  /** Puntuación acumulada a lo largo de la partida. */
  score: PartidaScore;
  /** Suma RAW de teamPts de cada mano (incluye el "baseline" de 50 de las manos ganadas).
   *  Es la "puntuación actual" que se muestra al jugador: cuanto suma el equipo
   *  en total, contando idas + vueltas. */
  cumulativeTeamPts: Record<0 | 1, number>;
  /** True si la partida terminó. Una vez true, no se siguen sumando vueltas. */
  matchEnded: boolean;
  /** Ganador de la partida (0 o 1). `null` mientras siga en juego. */
  matchWinner: 0 | 1 | null;

  readonly log: GameEvent[];
}

export type GameEvent =
  | { type: 'HAND_DEALT'; dealer: Seat; leader: Seat; trump: Suit; trumpCard: Card }
  | { type: 'CARD_PLAYED'; seat: Seat; card: Card }
  | { type: 'TRICK_RESOLVED'; winner: Seat; points: number; isLastTrick: boolean }
  | { type: 'CANTE_DECLARED'; seat: Seat; team: 0 | 1; suit: Suit; pair: readonly [number, number]; value: number }
  | { type: 'SEVEN_SWAPPED'; seat: Seat; taken: Card; given: Card }
  | { type: 'CARD_DRAWN'; seat: Seat; card: Card }
  | { type: 'HAND_FINISHED'; trickPoints: Record<0 | 1, number>; cantes: Cante[]; lastTrickBonus: number; score: PartidaScore; vuelta: number }
  | { type: 'MATCH_OVER'; winner: 0 | 1; score: PartidaScore; vuelta: number }
  | { type: 'GAME_OVER'; winner: 0 | 1; points: Record<0 | 1, number> };

export interface NewHandOptions {
  readonly id: string;
  readonly seed: string;
  readonly rules: RulesConfig;
  readonly dealer: Seat;
  /**
   * Continuación de la partida de vueltas. Si se omite, empieza partida nueva.
   * Si viene, se copia: vuelta, score, matchEnded, matchWinner.
   */
  readonly continuation?: {
    readonly vuelta: number;
    readonly score: PartidaScore;
    readonly cumulativeTeamPts: Record<0 | 1, number>;
    readonly matchEnded: boolean;
    readonly matchWinner: 0 | 1 | null;
  };
}

/**
 * Crea un estado nuevo para una mano: baraja, reparte, marca triunfo y salida.
 *
 * Reparto: 3+3 en orden `dealer+1, dealer+2, ..., dealer, dealer+1, ...` hasta
 * completar `handSize`. La última carta del mazo (la `handSize * players + 1`?)
 * NO, la que queda arriba del mazo al terminar de repartir es la visible.
 *
 * Para 4 jugadores con handSize 6: se reparten 24 cartas y quedan 16, de las
 * cuales la última es el triunfo visible.
 */
export function newHand(opts: NewHandOptions): GameState {
  const { id, seed, rules, dealer, continuation } = opts;
  if (rules.players !== 4) {
    throw new Error('Solo implementado para 4 jugadores en esta versión');
  }
  if (rules.handSize !== 6) {
    throw new Error('Solo implementado para handSize=6 (4×6=24 cartas)');
  }
  if (rules.dealBatch !== 3) {
    throw new Error('Solo implementado para dealBatch=3 (3+3)');
  }

  const rng: Rng = rngFromSeed(seed);
  const fullDeck = buildShuffledDeck(rng);

  // Repartimos 3+3 a cada asiento en orden antihorario empezando por dealer+1.
  // total a repartir = 24, quedan 16. La última del mazo (índice 39) es la visible.
  const hands: Record<Seat, Card[]> = { 0: [], 1: [], 2: [], 3: [] };
  const dealOrder: Seat[] = [1, 2, 3, 0, 1, 2]; // primera ronda 3+3 = 6
  let cursor = 0;
  // Primera ronda: 3 cartas por asiento (dealOrder 0..3 → 4 cartas? no, 4 seats × 3 = 12)
  // Reparto: 4 seats × 3 cartas = 12, luego 4 seats × 3 = 24. dealOrder = 6 por seat? No.
  // dealOrder debe contener 6 entradas (una por carta repartida), pero a cada seat le tocan 6.
  // El orden: dealer+1 primero, antihorario, una carta cada vez, hasta completar 6 por seat.
  // Para 3+3: 3 rondas? No, 3+3 son 2 rondas de 3 cartas = 6. Pero "se reparte de 3 en 3"
  // significa que en una ronda se dan 3 cartas (una por seat), se repite hasta 6.
  // Reparto: 6 vueltas de 1 carta, en grupos de 3 (2 tandas de 3 cartas).
  // En la realidad, los jugadores reciben primero 3 cartas, luego 3 más. Mantengo eso:
  //  - tanda 1: dealer+1, dealer+2, dealer+3, dealer (4 cartas, 1 por seat)
  //  - tanda 2: dealer+1, dealer+2, dealer+3, dealer (4 cartas, 1 por seat)
  // Eso son 2 cartas por seat. Para 6 cartas: 6 tandas. La regla "de 3 en 3" puede
  // referirse a "3 cartas de una vez por jugador por tanda".
  //
  // INTERPRETACIÓN: "se reparte de 3 en 3" = por cada tanda, el repartidor da 3 cartas
  // al primer jugador, 3 al segundo, etc. (a puñados). Para handSize=6 hay 2 tandas.
  // Pero el reparto a puñados no cambia el resultado; lo que importa es que cada uno
  // recibe 6 cartas y la siguiente del mazo es el triunfo.
  //
  // Implementación: 6 cartas por seat, una cada vez, en orden dealer+1 primero.
  const order: Seat[] = [];
  for (let i = 0; i < rules.handSize; i++) {
    for (let s = 1; s <= 4; s++) {
      order.push(((dealer + s) % 4) as Seat);
    }
  }
  for (const seat of order) {
    const card = fullDeck[cursor++]!;
    hands[seat]!.push(card);
  }

  // Tras repartir 24 cartas, quedan 16. La última (índice 39) es el triunfo visible.
  const trumpCard = fullDeck[fullDeck.length - 1]!;
  const trump: Suit = trumpCard.suit;
  const remainingDeck = fullDeck.slice(cursor, fullDeck.length - 1); // mazo sin la visible

  // Quien sale primero: dealer+1.
  const leader = ((dealer + 1) % 4) as Seat;

  const log: GameEvent[] = [
    { type: 'HAND_DEALT', dealer, leader, trump, trumpCard },
  ];

  // Defaults si no hay continuación (partida nueva). Si hay, conservar.
  const partidaInit = continuation ?? {
    vuelta: 1,
    score: { buenas: { 0: 0, 1: 0 }, malas: { 0: 0, 1: 0 } },
    matchEnded: false,
    matchWinner: null,
  };

  return {
    id,
    seed,
    version: 0,
    rules,
    phase: 'lead',
    dealer,
    turn: leader,
    leader,
    trump,
    trumpCard,
    deck: remainingDeck,
    hands,
    trick: { plays: [] },
    finishedTricks: [],
    trickPoints: { 0: 0, 1: 0 },
    cantes: [],
    lastWinner: null,
    pendingLastTrick: false,
    vuelta: continuation?.vuelta ?? 1,
    score: continuation?.score ?? { buenas: { 0: 0, 1: 0 }, malas: { 0: 0, 1: 0 } },
    cumulativeTeamPts: continuation?.cumulativeTeamPts ?? { 0: 0, 1: 0 },
    matchEnded: continuation?.matchEnded ?? false,
    matchWinner: continuation?.matchWinner ?? null,
    log,
  };
}

/**
 * Saca la primera carta del mazo (la del final, ya que repartimos del inicio).
 */
export function drawTop(state: GameState): Card {
  const card = state.deck.pop();
  if (!card) throw new Error('Mazo vacío');
  return card;
}

export function handSize(state: GameState, seat: Seat): number {
  return state.hands[seat]!.length;
}

export function isTrump(card: Card, trump: Suit): boolean {
  return card.suit === trump;
}

export function allSuits(): readonly Suit[] {
  return SUITS;
}
