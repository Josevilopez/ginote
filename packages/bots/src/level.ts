import type { Action, GameState, Seat } from '@guinote/engine';
import { randomBotAction } from './random.js';
import { heuristicBotAction } from './heuristic.js';

/**
 * S2-10: niveles de bot.
 *  - `1` (fácil): juega cualquier acción legal al azar.
 *  - `2` (normal): heurística (`heuristic.ts`): cantes, cambio del 7,
 *    gana bazas con puntos, no tira triunfos a lo tonto, etc.
 *
 * Mismo contrato que los bots existentes: sin estado, decide UNA acción
 * mirando el estado; `null` si no le toca.
 */
export type BotLevel = 1 | 2;

/** Nivel por defecto para los bots que rellenan mesas. */
export const DEFAULT_BOT_LEVEL: BotLevel = 2;

export function botAction(state: GameState, seat: Seat, level: BotLevel): Action | null {
  return level === 1 ? randomBotAction(state, seat) : heuristicBotAction(state, seat);
}

/** Rango del "tiempo de pensar" de un bot antes de cada acción (ms). */
export const BOT_THINK_MIN_MS = 600;
export const BOT_THINK_MAX_MS = 1500;

/**
 * Retardo artificial antes de que un bot actúe: aleatorio entre 600 y
 * 1500 ms para que la mesa parezca de personas (antes era 1 s fijo, muy
 * mecánico). `rand` inyectable para tests.
 */
export function botThinkDelayMs(rand: () => number = Math.random): number {
  return Math.round(BOT_THINK_MIN_MS + rand() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS));
}
