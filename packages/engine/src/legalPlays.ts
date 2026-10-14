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
 * Inputs mínimos que necesita el cálculo de cartas legales. NO requiere el
 * `GameState` completo (que tiene docenas de campos que no intervienen en
 * esta decisión). Pensado para que clientes con solo el `PlayerView` (lo
 * que llega por WebSocket del servidor) puedan preguntar al motor qué
 * cartas son legales sin reconstruir el estado entero.
 */
export interface LegalPlaysQuery {
  readonly hand: readonly Card[];
  /** Cartas ya echadas en la baza en curso (incluida la salida). Vacío al salir. */
  readonly trick: readonly Play[];
  /** `null` durante el arrastre (no hay triunfo visible). */
  readonly trumpCard: Card | null;
  readonly trump: Suit;
  readonly rules: RulesConfig;
}

/**
 * Implementación única de la regla "qué cartas son legales ahora". Vive en
 * un helper con inputs mínimos para que `legalPlays(state, seat)` (servidor)
 * y `legalPlaysFromView(query, seat)` (cliente) deleguen aquí y NUNCA
 * puedan divergir.
 *
 * Reglas cubiertas (todas viven en `rules.arrastre`):
 *  - Fase de robo (`trumpCard !== null`): todo legal (sigue la "ventaja" del robo).
 *  - Salida (primera carta): todo legal.
 *  - Seguir palo: si tienes cartas del palo de salida, solo puedes jugar esas.
 *  - Superar: si el compañero NO va ganando, tienes que superar la carta que
 *    va ganando. Si no puedes, juegas cualquiera del palo (te "cubres" cuanto
 *    puedas).
 *  - Fallar con triunfo: si no tienes el palo de salida y tienes triunfo,
 *    juegas triunfo. Si el compañero va ganando, esta obligación se omite.
 *    Si tu triunfo NO supera al de mesa y `mustTrumpEvenIfCantBeat` es false,
 *    puedes descartar (no estás obligado a tirar el triunfo flojo).
 *  - Si no tienes ni palo ni triunfo, juegas lo que quieras.
 */
export function computeLegalCards(q: LegalPlaysQuery, seat: Seat): Card[] {
  const { hand, trick, trumpCard, trump, rules } = q;

  // Fase de robo: todavía no hay obligación de asistir.
  if (trumpCard !== null) return hand.slice();

  // Salida: cualquier carta.
  if (trick.length === 0) return hand.slice();

  const a = rules.arrastre;
  const ledSuit = trick[0]!.card.suit;
  const winning = currentWinner(trick, trump, rules);
  const partnerWins = winning.seat !== seat && partnerOf(winning.seat) === seat;

  const sameSuit = hand.filter((c) => c.suit === ledSuit);
  if (sameSuit.length > 0) {
    if (!a.mustOverplay || (partnerWins && a.partnerWinningExemptsOverplay)) {
      return sameSuit.slice();
    }
    const higher = sameSuit.filter((c) => beats(c, winning.card, trump, rules));
    return higher.length > 0 ? higher.slice() : sameSuit.slice();
  }

  const trumps = hand.filter((c) => c.suit === trump);
  if (trumps.length > 0 && a.mustTrumpIfVoid && !(partnerWins && a.partnerWinningExemptsTrump)) {
    const higher = trumps.filter((c) => beats(c, winning.card, trump, rules));
    if (higher.length > 0) return higher.slice();
    return a.mustTrumpEvenIfCantBeat ? trumps.slice() : hand.slice();
  }

  return hand.slice();
}

/**
 * API para el servidor (que tiene el `GameState` completo). Delegada en
 * `computeLegalCards` para no duplicar la lógica.
 */
export function legalPlays(state: GameState, seat: Seat): Card[] {
  return computeLegalCards(
    {
      hand: state.hands[seat]!,
      trick: state.trick.plays,
      trumpCard: state.trumpCard,
      trump: state.trump,
      rules: state.rules,
    },
    seat,
  );
}

/**
 * API para clientes (que solo tienen la vista `PlayerView` del servidor).
 * Pasa los inputs mínimos al motor y devuelve las cartas legales. El
 * frontend SIEMPRE debe usar esta función; nunca replicar la lógica a mano
 * (esa fue la fuente del bug "te obliga a tirar bastos" en el cliente,
 * reportado por el jugador).
 */
export function legalPlaysFromView(q: LegalPlaysQuery, seat: Seat): Card[] {
  return computeLegalCards(q, seat);
}
