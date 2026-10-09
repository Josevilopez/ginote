import { ALL_RANKS, SUITS, type Card, card } from './types.js';
import { shuffle, type Rng } from './shuffle.js';

/**
 * Construye una baraja española de 40 cartas y la baraja con el Rng dado.
 * Devuelve el resultado; no muta entrada externa.
 */
export function buildShuffledDeck(rng: Rng): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push(card(suit, rank));
    }
  }
  return shuffle(deck, rng);
}
