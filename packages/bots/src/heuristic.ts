import {
  apply,
  beats,
  currentWinner,
  legalActions,
  teamOf,
  type Action,
  type Card,
  type GameState,
  type Seat,
} from '@guinote/engine';

/**
 * Bot heurístico. Sustituye al `randomBotAction` para partidas locales: aplica
 * reglas fijas en vez de elegir al azar. Nivel: gana a jugadores casuales,
 * pierde contra los que ya saben contar.
 *
 * Reglas (por orden de prioridad):
 *  1. CANTE: si hay cantes legales, canta el de más valor (40 > 20). El
 *     popup "canta +40" sigue apareciendo en la UI; el cliente no tiene que
 *     pulsar nada.
 *  2. SWAP_SEVEN: si es legal, cámbialo (el motor ya filtra cuándo compensa).
 *  3. JUGAR CARTA — principio general: LOS TRIUNFOS SON UN RECURSO ESCASO.
 *     Si tienes cualquier no-triunfo en tus cartas legales, JUEGA ESE
 *     (aunque sea más caro en puntos). Solo se juega un triunfo cuando:
 *       (a) eres el que sale y no te queda otra cosa, o
 *       (b) estás obligado por las reglas (no tienes el palo de salida y
 *           debes fallar con triunfo), o
 *       (c) no puedes ganar la baza de ninguna otra forma.
 *     Detalle por caso:
 *      - Salida (truco vacío): no-triunfo barato; si solo te quedan
 *        triunfos, el más barato.
 *      - Compañero ganando, NO soy el último: nunca matar a tu compañero
 *        con un triunfo; juega el no-triunfo más barato. Si solo te
 *        quedan triunfos, el más barato. (Aún no sabemos si la baza
 *        acaba aquí — un rival podría ganárnosla.)
 *      - Compañero ganando, SÍ soy el último: la baza acaba con mi carta
 *        y se la lleva mi compañero → DONARLE puntos no-triunfo. Tira
 *        la carta con más puntos que NO forme parte de un par Sota+Rey
 *        cantable (esos se reservan para futuras "veintes"). Si no te
 *        queda nada donable, el no-triunfo más barato; en último caso,
 *        triunfo más barato.
 *      - Rival ganando, PUEDO ganar: no-triunfo ganador más barato;
 *        si solo puedes ganar con triunfo, el triunfo más barato.
 *      - Rival ganando, NO puedo ganar: no-triunfo más barato;
 *        si solo te quedan triunfos, el más barato.
 *
 * "Más barata" = menos puntos (As 11 > 3 10 > Rey 4 > Sota 3 > Caballo 2 > 7..2 0).
 * "Más cara" (caso "donar") = más puntos, y dentro del mismo valor la más
 * fuerte (menor índice de `rules.strength`). En empate total gana la primera.
 */

const VALUE_BY_RANK: Record<number, number> = {
  1: 11,
  3: 10,
  12: 4,
  10: 3,
  11: 2,
  7: 0,
  6: 0,
  5: 0,
  4: 0,
  2: 0,
};

/** Puntos de una carta según las reglas. Cero por defecto. */
function cardPoints(c: Card): number {
  return VALUE_BY_RANK[c.rank] ?? 0;
}

/** Índice en `rules.strength` (menor = más fuerte). 99 para cartas no listadas. */
function strengthIdx(c: Card, rules: GameState['rules']): number {
  return rules.strength.indexOf(c.rank);
}

/**
 * Devuelve la carta "más barata" de un conjunto: menos puntos primero, y
 * dentro del mismo valor, la más débil (mayor índice en rules.strength).
 * Si hay empate total, la primera del array.
 */
function cheapestCard(cards: readonly Card[], rules: GameState['rules']): Card {
  if (cards.length === 0) {
    throw new Error('cheapestCard: no se puede elegir carta de un array vacío');
  }
  let best = cards[0]!;
  for (let i = 1; i < cards.length; i++) {
    const c = cards[i]!;
    const cPts = cardPoints(c);
    const bPts = cardPoints(best);
    if (cPts < bPts) {
      best = c;
      continue;
    }
    if (cPts > bPts) continue;
    // Empate de puntos: más débil = índice de fuerza mayor
    if (strengthIdx(c, rules) > strengthIdx(best, rules)) {
      best = c;
    }
  }
  return best;
}

/**
 * Devuelve la carta "más cara" de un conjunto: más puntos primero, y
 * dentro del mismo valor, la más fuerte (menor índice en rules.strength).
 * Espejo de `cheapestCard`, para los casos donde queremos DONAR puntos
 * a la baza del compañero. Si hay empate total, la primera del array.
 */
function mostExpensiveCard(cards: readonly Card[], rules: GameState['rules']): Card {
  if (cards.length === 0) {
    throw new Error('mostExpensiveCard: no se puede elegir carta de un array vacío');
  }
  let best = cards[0]!;
  for (let i = 1; i < cards.length; i++) {
    const c = cards[i]!;
    const cPts = cardPoints(c);
    const bPts = cardPoints(best);
    if (cPts > bPts) {
      best = c;
      continue;
    }
    if (cPts < bPts) continue;
    // Empate de puntos: más fuerte = índice de fuerza menor
    if (strengthIdx(c, rules) < strengthIdx(best, rules)) {
      best = c;
    }
  }
  return best;
}

/**
 * Devuelve la mejor carta a JUGAR en un `legalPlays` dado. Estrategia:
 * "triunfos son un recurso escaso" — si tienes cualquier no-triunfo
 * entre las legales, juega no-triunfo, aunque sea más caro en puntos.
 */
function pickPlayCard(state: GameState, seat: Seat, legalCards: readonly Card[]): Card {
  const rules = state.rules;
  const trump = state.trump;
  const trick = state.trick.plays;

  // Partimos las legales en no-triunfo / triunfo.
  const nonTrumps = legalCards.filter((c) => c.suit !== trump);
  const trumps = legalCards.filter((c) => c.suit === trump);

  // Caso 1: salgo yo. Sin baza previa, no hay "ganador actual" que ganar.
  if (trick.length === 0) {
    if (nonTrumps.length > 0) return cheapestCard(nonTrumps, rules);
    // Solo me quedan triunfos: juego el más barato.
    return cheapestCard(trumps, rules);
  }

  // Caso 2: la baza ya tiene cartas. Evalúo al ganador actual y a su equipo.
  const winner = currentWinner(trick, trump, rules);
  const winnerTeam = teamOf(winner.seat);
  const myTeam = teamOf(seat);

  // Si va ganando un compañero, NO MATAR CON TRIUNFO.
  if (winnerTeam === myTeam) {
    // Caso especial: soy el ÚLTIMO en tirar (4ª carta de la baza).
    // Después de mi jugada la baza se cierra y los puntos van a mi
    // equipo. Dono la mayor cantidad de puntos no-triunfo que no
    // pertenezcan a un par Sota+Rey cantable.
    if (trick.length === 3) {
      const saveSuits = new Set<string>();
      const sotaSuits = new Set<string>();
      const reySuits = new Set<string>();
      for (const c of state.hands[seat]!) {
        if (c.suit === trump) continue;
        if (c.rank === 10) sotaSuits.add(c.suit);
        if (c.rank === 12) reySuits.add(c.suit);
      }
      // Un suit entra en `saveSuits` solo si tengo AMBAS cartas (Sota y
      // Rey). Esos son los pares que se reservan para futuras "veintes".
      for (const s of sotaSuits) {
        if (reySuits.has(s)) saveSuits.add(s);
      }
      const isSaveCard = (c: Card) =>
        c.suit !== trump && saveSuits.has(c.suit) && (c.rank === 10 || c.rank === 12);

      const freeNonTrumps = nonTrumps.filter((c) => !isSaveCard(c));
      if (freeNonTrumps.length > 0) {
        // Tira la más cara — más puntos para el equipo.
        return mostExpensiveCard(freeNonTrumps, rules);
      }
      // Solo me quedan cartas del par Sota+Rey (o solo triunfos). Mejor
      // soltar la más barata de las no-triunfo (mínima pérdida del par)
      // que malgastar un triunfo.
      if (nonTrumps.length > 0) return cheapestCard(nonTrumps, rules);
      return cheapestCard(trumps, rules);
    }

    // No soy el último: la baza aún puede cambiar de manos. Juega el
    // no-triunfo más barato y deja que él se la lleve. Si solo quedan
    // triunfos, el más barato (nunca mates con triunfo a tu compañero).
    if (nonTrumps.length > 0) return cheapestCard(nonTrumps, rules);
    return cheapestCard(trumps, rules);
  }

  // Va ganando un rival. ¿Puedo ganarle?
  const winningCards = legalCards.filter((c) => beats(c, winner.card, trump, rules));
  if (winningCards.length > 0) {
    // Sí: si tengo un NO-TRIUNFO que gana, lo prefiero (conservo el
    // triunfo). Si solo me sirve un triunfo, el más barato.
    const nonTrumpWinners = winningCards.filter((c) => c.suit !== trump);
    if (nonTrumpWinners.length > 0) return cheapestCard(nonTrumpWinners, rules);
    return cheapestCard(winningCards, rules);
  }

  // No puedo ganar: suelto lo más barato. Si tengo no-triunfo, lo prefiero.
  if (nonTrumps.length > 0) return cheapestCard(nonTrumps, rules);
  return cheapestCard(trumps, rules);
}

/**
 * Si el bot tiene varios cantes posibles, prefiere el de más valor
 * (40 de triunfo > 20 de cualquier otro palo). Si hay empate, el primero.
 */
function pickCante(state: GameState, canteActions: Action[]): Action {
  const trump = state.trump;
  const valued = canteActions
    .filter((a): a is Extract<Action, { type: 'SING_CANTE' }> => a.type === 'SING_CANTE')
    .map((a) => ({ action: a, value: a.suit === trump ? 40 : 20 }));
  valued.sort((a, b) => b.value - a.value);
  return valued[0]!.action;
}

/**
 * Decide la mejor acción LEGAL disponible para el bot. Devuelve `null` si
 * no hay nada que hacer (p. ej. esperando a otro jugador).
 *
 * Prioridad:
 *  - winnerWindow: cante > swap7 > pass
 *  - lead/follow: cante > jugar carta
 */
export function heuristicBotAction(state: GameState, seat: Seat): Action | null {
  const actions = legalActions(state, seat);
  if (actions.length === 0) return null;

  const cantes = actions.filter((a) => a.type === 'SING_CANTE');
  if (cantes.length > 0) {
    return pickCante(state, cantes);
  }

  if (state.phase === 'winnerWindow') {
    // No hay cante; si puedo cambiar el 7, lo cambio (es un upgrade claro).
    const swap = actions.find((a) => a.type === 'SWAP_SEVEN');
    if (swap) return swap;
    // Si no, paso para que la ventana avance.
    return { type: 'PASS' };
  }

  // lead / follow sin cante: jugar la mejor carta.
  const hand = state.hands[seat]!;
  const playCardIds = actions
    .filter((a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD')
    .map((a) => a.cardId);
  const legalCards = hand.filter((c) => playCardIds.includes(c.id));
  if (legalCards.length === 0) {
    // Sin cartas legales para jugar (no debería pasar si legalActions es
    // fuente de verdad); caigo a la primera acción disponible.
    return actions[0]!;
  }
  const chosen = pickPlayCard(state, seat, legalCards);
  return { type: 'PLAY_CARD', cardId: chosen.id };
}

/**
 * Aplica una acción del bot al estado. Devuelve `true` si actuó, `false` si
 * no había nada que hacer.
 */
export function stepHeuristicBot(state: GameState, seat: Seat): boolean {
  const action = heuristicBotAction(state, seat);
  if (!action) return false;
  apply(state, action);
  return true;
}
