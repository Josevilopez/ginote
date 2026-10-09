import { apply, legalActions, type Action, type GameState, type Seat } from '@guinote/engine';

/**
 * Bot aleatorio. Elige una acción legal al azar. Sirve como placeholder hasta
 * tener un bot heurístico o ISMCTS.
 *
 * El bot no tiene estado interno; cada llamada decide una sola acción mirando
 * el estado actual. Si la fase es `winnerWindow` y la acción es `PASS`, el
 * `apply` se encarga de avanzar la ventana; eso ya lo gestiona el motor.
 */
export function randomBotAction(state: GameState, seat: Seat): Action | null {
  const actions = legalActions(state, seat);
  if (actions.length === 0) return null;
  return actions[Math.floor(Math.random() * actions.length)]!;
}

/**
 * Aplica una acción del bot al estado. Devuelve `true` si actuó, `false` si no
 * había nada que hacer (p. ej. esperando a otro jugador).
 */
export function stepBot(state: GameState, seat: Seat): boolean {
  const action = randomBotAction(state, seat);
  if (!action) return false;
  apply(state, action);
  return true;
}
