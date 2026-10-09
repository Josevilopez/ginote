import type { Suit } from './types.js';

/**
 * Acciones que puede enviar un jugador (o un bot) al motor.
 * El servidor las valida contra `legalActions` antes de aplicarlas.
 */
export type Action =
  | { type: 'PLAY_CARD'; cardId: string }
  | { type: 'SWAP_SEVEN' }
  | { type: 'SING_CANTE'; suit: Suit; pair: readonly [number, number] }
  | { type: 'PASS' };

export type ActionType = Action['type'];
