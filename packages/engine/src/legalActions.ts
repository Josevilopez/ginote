import type { Action } from './actions.js';
import type { GameState } from './state.js';
import type { Seat, Suit } from './types.js';
import { partnerOf } from './types.js';
import { legalPlays } from './legalPlays.js';
import { canSwapSevenWithTrump } from './rules.js';

/**
 * ¿Tiene `seat` en la mano el par Rey+Sota de `suit`?
 */
function tienePareja(state: GameState, seat: Seat, suit: Suit): boolean {
  const [a, b] = state.rules.cantes.pair;
  return state.hands[seat]!.some((c) => c.suit === suit && c.rank === a) &&
    state.hands[seat]!.some((c) => c.suit === suit && c.rank === b);
}

/**
 * ¿Ya se cantó ese par por algún equipo? Devuelve true si el cante ya está en el log.
 */
function canteYaCantado(state: GameState, suit: Suit): boolean {
  return state.cantes.some((c) => c.suit === suit);
}

/**
 * Cantes que `seat` puede cantar ahora mismo. Devuelve los suits en los que tiene
 * el par Rey+Sota y no se haya cantado aún.
 */
function cantesPosibles(state: GameState, seat: Seat): Suit[] {
  const result: Suit[] = [];
  const suits: Suit[] = ['oros', 'copas', 'espadas', 'bastos'];
  for (const s of suits) {
    if (tienePareja(state, seat, s) && !canteYaCantado(state, s)) {
      result.push(s);
    }
  }
  return result;
}

/**
 * ¿Puede `seat` cantar ahora mismo? Siempre se exige haber ganado la última
 * baza (o ser compañero del ganador). En arrastre (sin triunfo visible)
 * se aplica además el flag `cantes.allowedInArrastre` del motor (si está
 * a false, los cantes solo se permiten en la winnerWindow).
 */
function puedeCantar(state: GameState, seat: Seat): boolean {
  if (state.lastWinner === null) return false;
  if (state.lastWinner !== seat && state.lastWinner !== partnerOf(seat)) return false;
  if (state.trumpCard === null && !state.rules.cantes.allowedInArrastre) return false;
  return true;
}

/**
 * Devuelve todas las acciones legales que `seat` puede enviar AHORA.
 * Es la fuente de verdad: el cliente solo resalta cartas que aparezcan aquí.
 */
export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.phase === 'finished') return [];
  if (state.turn !== seat) return [];

  const actions: Action[] = [];
  const hand = state.hands[seat]!;

  if (state.phase === 'lead' || state.phase === 'follow') {
    for (const card of legalPlays(state, seat)) {
      actions.push({ type: 'PLAY_CARD', cardId: card.id });
    }
    // Cante durante el arrastre, tan pronto se pueda: tanto en 'lead' (el
    // ganador lleva la primera baza justo después del `draw`, momento en
    // que puede haber completado la pareja) como en 'follow' (cualquier
    // baza posterior). El motor ya exige ganador o compañero en la baza
    // anterior y, si no hay triunfo visible, el flag `allowedInArrastre`.
    if (puedeCantar(state, seat)) {
      for (const suit of cantesPosibles(state, seat)) {
        actions.push({ type: 'SING_CANTE', suit, pair: [state.rules.cantes.pair[0], state.rules.cantes.pair[1]] });
      }
    }
    return actions;
  }

  if (state.phase === 'winnerWindow') {
    actions.push({ type: 'PASS' });
    // Cambio del 7: solo ganador o compañero, solo en draw, y solo si
    // tiene el 7 de triunfo. Además, el triunfo visible debe ser una carta
    // SUPERIOR al 7 (1, 3, 10, 11, 12); si no, no compensa soltar el 7.
    if (canSwapSevenWithTrump(state.trumpCard)) {
      const sevenId = `${state.trump}-7`;
      const hasSeven = hand.some((c) => c.id === sevenId);
      if (hasSeven && state.lastWinner !== null &&
          (state.lastWinner === seat || state.lastWinner === partnerOf(seat))) {
        actions.push({ type: 'SWAP_SEVEN' });
      }
    }
    // Cante en winnerWindow
    if (puedeCantar(state, seat)) {
      for (const suit of cantesPosibles(state, seat)) {
        actions.push({ type: 'SING_CANTE', suit, pair: [state.rules.cantes.pair[0], state.rules.cantes.pair[1]] });
      }
    }
    return actions;
  }

  return actions;
}
