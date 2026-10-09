/**
 * Tipos básicos del motor de guiñote.
 *
 * Convenciones:
 *  - `Rank` numérico: 1 = As, 2..7 = numéricas, 10 = Sota, 11 = Caballo, 12 = Rey.
 *  - `Seat` 0..3; el sentido de juego es antihorario, así que el "siguiente" es (seat + 1) % 4.
 *  - `Team` 0 o 1; los seats 0 y 2 son compañeros, y 1 y 3 también.
 */

export type Suit = 'oros' | 'copas' | 'espadas' | 'bastos';

export const SUITS: readonly Suit[] = ['oros', 'copas', 'espadas', 'bastos'] as const;

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12;

export const NUMERIC_RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7] as const;
export const FIGURE_RANKS: readonly Rank[] = [10, 11, 12] as const;
export const ALL_RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;

export type Seat = 0 | 1 | 2 | 3;

export type Team = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

export interface Card {
  /** Identificador estable, p. ej. "oros-1" (As de oros). Sirve para vistas. */
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
}

export const cardId = (suit: Suit, rank: Rank): string => `${suit}-${rank}`;

export const card = (suit: Suit, rank: Rank): Card => ({ id: cardId(suit, rank), suit, rank });

export const partnerOf = (seat: Seat): Seat => {
  // Seat 0 ↔ 2, 1 ↔ 3. Mapeo explícito para que sea claro.
  switch (seat) {
    case 0:
      return 2;
    case 1:
      return 3;
    case 2:
      return 0;
    case 3:
      return 1;
  }
};

export const teamOf = (seat: Seat): Team => (seat === 0 || seat === 2 ? 0 : 1);

export const nextSeat = (seat: Seat, players: 4 = 4): Seat =>
  ((seat + 1) % players) as Seat;
