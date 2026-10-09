import type { Action } from './actions.js';
import type { GameState } from './state.js';
import type { Seat, Suit } from './types.js';
import { partnerOf } from './types.js';
import { legalPlays } from './legalPlays.js';

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
 * ¿Puede `seat` cantar ahora mismo? Solo el ganador de la baza y su compañero
 * (en la winnerWindow) o cualquier jugador (en arrastre, si el flag lo permite).
 */
function puedeCantar(state: GameState, seat: Seat): boolean {
  if (state.trumpCard !== null) {
    // fase de robo: solo el ganador de la última baza y su compañero
    if (state.lastWinner === null) return false;
    return state.lastWinner === seat || state.lastWinner === partnerOf(seat);
  }
  // arrastre: cualquiera puede cantar (si el flag lo permite)
  return state.rules.cantes.allowedInArrastre;
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
    // Cante en arrastre
    if (state.phase === 'follow' && puedeCantar(state, seat)) {
      for (const suit of cantesPosibles(state, seat)) {
        actions.push({ type: 'SING_CANTE', suit, pair: [state.rules.cantes.pair[0], state.rules.cantes.pair[1]] });
      }
    }
    return actions;
  }

  if (state.phase === 'winnerWindow') {
    actions.push({ type: 'PASS' });
    // Cambio del 7: solo ganador o compañero, solo en draw, y solo si tiene el 7 de triunfo
    if (state.trumpCard !== null) {
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
