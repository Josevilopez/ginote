import type { Card, Seat, Suit } from './types.js';
import { partnerOf } from './types.js';
import type { RulesConfig } from './rules.js';
import type { GameState, Play } from './state.js';

/**
 * Devuelve el índice de fuerza de la carta (menor = más fuerte). Usa `RulesConfig.strength`.
 */
function strength(c: Card, rules: RulesConfig): number {
  return rules.strength.indexOf(c.rank);
}

/**
 * ¿`a` gana a `b`? Mismo palo: gana el de mayor fuerza (índice menor en `strength`).
 * Distinto palo: solo gana el triunfo si `b` no es triunfo.
 */
export function beats(a: Card, b: Card, trump: Suit, rules: RulesConfig): boolean {
  if (a.suit === b.suit) return strength(a, rules) < strength(b, rules);
  return a.suit === trump && b.suit !== trump;
}

/**
 * Calcula el ganador actual de una baza en curso. `plays[0]` es la salida.
 */
export function currentWinner(plays: readonly Play[], trump: Suit, rules: RulesConfig): Play {
  let best = plays[0]!;
  for (let i = 1; i < plays.length; i++) {
    const p = plays[i]!;
    if (beats(p.card, best.card, trump, rules)) {
      best = p;
    }
  }
  return best;
}

/**
 * Cartas legales que `seat` puede jugar ahora mismo.
 *
 * Reglas cubiertas (todas viven en `RulesConfig.arrastre`):
 *  - Fase de robo (`trumpCard !== null`): todo legal (sigue la "ventaja" del robo).
 *  - Salida (primera carta): todo legal.
 *  - Seguir palo: si tienes cartas del palo de salida, solo puedes jugar esas.
 *  - Superar: si el compañero NO va ganando, tienes que superar la carta que va ganando.
 *    Si no puedes, juegas cualquiera del palo (te "cubres" cuanto puedas).
 *  - Fallar con triunfo: si no tienes el palo de salida y tienes triunfo, juegas triunfo.
 *    Si el compañero va ganando, esta obligación se omite.
 *  - Si no tienes ni palo ni triunfo, juegas lo que quieras.
 */
export function legalPlays(state: GameState, seat: Seat): Card[] {
  const hand = state.hands[seat]!;
  const trick = state.trick;

  // Fase de robo: todavía no hay obligación de asistir.
  if (state.trumpCard !== null) return hand;

  // Salida: cualquier carta.
  if (trick.plays.length === 0) return hand;

  const a = state.rules.arrastre;
  const ledSuit = trick.plays[0]!.card.suit;
  const winning = currentWinner(trick.plays, state.trump, state.rules);
  const partnerWins = winning.seat !== seat && partnerOf(winning.seat) === seat;

  const sameSuit = hand.filter((c) => c.suit === ledSuit);
  if (sameSuit.length > 0) {
    if (!a.mustOverplay || (partnerWins && a.partnerWinningExemptsOverplay)) {
      return sameSuit;
    }
    const higher = sameSuit.filter((c) => beats(c, winning.card, state.trump, state.rules));
    return higher.length > 0 ? higher : sameSuit;
  }

  const trumps = hand.filter((c) => c.suit === state.trump);
  if (trumps.length > 0 && a.mustTrumpIfVoid && !(partnerWins && a.partnerWinningExemptsTrump)) {
    const higher = trumps.filter((c) => beats(c, winning.card, state.trump, state.rules));
    if (higher.length > 0) return higher;
    return a.mustTrumpEvenIfCantBeat ? trumps : hand;
  }

  return hand;
}
