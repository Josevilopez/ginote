import type { Action } from './actions.js';
import type { GameState, GameEvent, Cante } from './state.js';
import type { Card, Seat, Suit, Team } from './types.js';
import { nextSeat, partnerOf, teamOf } from './types.js';
import { beats, currentWinner } from './legalPlays.js';
import { canSwapSevenWithTrump } from './rules.js';

const SEATS_4: readonly Seat[] = [0, 1, 2, 3] as const;

/**
 * Suma los puntos de las cartas de la baza (sin incluir 10 de últimas).
 */
function puntosBaza(cards: readonly Card[], rules: GameState['rules']): number {
  let total = 0;
  for (const c of cards) {
    total += rules.cardPoints[c.rank] ?? 0;
  }
  return total;
}

/**
 * Ejecuta la fase de robo. `winner` es el ganador de la baza resuelta. La
 * implementación es determinista: cada asiento en orden antihorario desde el
 * ganador toma una carta del mazo, o toma `trumpCard` si era la última.
 *
 *   - Mientras queden cartas en `state.deck`, se roba de ahí.
 *   - Si `state.deck` está vacío y `trumpCard !== null`, el siguiente al ganador
 *     que aún no haya robado toma la `trumpCard` y la fase pasa a arrastre.
 *
 * Devuelve los eventos `CARD_DRAWN` generados.
 */
function draw(state: GameState, winner: Seat): GameEvent[] {
  const events: GameEvent[] = [];
  const startIdx = SEATS_4.indexOf(winner);
  for (let i = 0; i < 4; i++) {
    const seat = SEATS_4[(startIdx + i) % 4]!;
    if (state.deck.length > 0) {
      const card = state.deck.pop()!;
      state.hands[seat]!.push(card);
      events.push({ type: 'CARD_DRAWN', seat, card });
    } else if (state.trumpCard !== null) {
      const tc = state.trumpCard;
      state.hands[seat]!.push(tc);
      state.trumpCard = null;
      events.push({ type: 'CARD_DRAWN', seat, card: tc });
      break;
    } else {
      break;
    }
  }
  return events;
}

/**
 * Comprueba si tras un cambio de `cumulativeTeamPts` algún equipo ha
 * cruzado el umbral de cierre de partida y emite `MATCH_OVER`. Es
 * idempotente: una vez `matchEnded` es `true`, no emite más aunque se
 * llame otra vez.
 *
 * Decisión de diseño: NO se gestionan "Buenas" y "Malas" como contadores
 * separados en el estado (eso era un intento anterior que añadía
 * complejidad sin valor). El motor solo suma puntos raw en
 * `cumulativeTeamPts`, preservado entre manos vía `continuation`. La
 * noción de "Buenas" / "Malas" es PURAMENTE presentación — el cliente
 * pinta rojo (≤ threshold) o blanco (> threshold) en función del valor
 * raw, y dispara MATCH_OVER con el mismo corte.
 */
function maybeEndMatch(state: GameState, events: GameEvent[]): void {
  if (state.matchEnded) return;
  if (!state.rules.scoring) return;
  const t = state.rules.scoring.threshold;
  for (const team of [0, 1] as const) {
    if ((state.cumulativeTeamPts[team] ?? 0) > t) {
      state.matchEnded = true;
      state.matchWinner = team;
      events.push({
        type: 'MATCH_OVER',
        winner: team,
        score: { ...state.score },
        vuelta: state.vuelta,
      });
      break;
    }
  }
}

/**
 * Aplica una acción al estado. Devuelve los eventos generados.
 *
 * Lanza `Error` si la acción no es legal. El servidor debe haber validado con
 * `legalActions` antes de llamar.
 */
export function apply(state: GameState, action: Action): GameEvent[] {
  const events: GameEvent[] = [];
  const seat = state.turn;

  if (seat === null) {
    throw new Error('No hay turno activo');
  }

  if (action.type === 'PLAY_CARD') {
    if (state.phase !== 'lead' && state.phase !== 'follow') {
      throw new Error(`PLAY_CARD no es legal en phase=${state.phase}`);
    }
    const card = state.hands[seat]!.find((c) => c.id === action.cardId);
    if (!card) {
      throw new Error(`Carta no encontrada en mano: ${action.cardId}`);
    }
    // Sacar carta de la mano.
    state.hands[seat] = state.hands[seat]!.filter((c) => c.id !== action.cardId);
    state.trick = { plays: [...state.trick.plays, { seat, card }] };
    events.push({ type: 'CARD_PLAYED', seat, card });

    if (state.trick.plays.length === 4) {
      // Baza completa. Resolver.
      const winnerPlay = currentWinner(state.trick.plays, state.trump, state.rules);
      const winner = winnerPlay.seat;
      const trickPoints = puntosBaza(state.trick.plays.map((p) => p.card), state.rules);
      const allHandsEmpty = SEATS_4.every((s) => state.hands[s]!.length === 0);
      const isLastTrick = allHandsEmpty && state.deck.length === 0 && state.trumpCard === null;
      const effectivePoints = isLastTrick ? trickPoints + state.rules.lastTrickBonus : trickPoints;
      const team: Team = teamOf(winner);
      // Sumar al running trickPoints (esta mano).
      state.trickPoints[team] = (state.trickPoints[team] ?? 0) + effectivePoints;
      // Sumar al acumulado raw de la partida (lo que ve el cliente en
      // la cabecera). Crece baza a baza Y se preserva entre manos
      // vía `continuation` en `newHand`. No diferenciamos Buenas/Malas
      // aquí: la noción es puramente visual y vive en la UI.
      state.cumulativeTeamPts[team] = (state.cumulativeTeamPts[team] ?? 0) + effectivePoints;
      // Comprobar fin de partida con el raw, mismo corte que pinta el
      // cliente (cualquier valor > threshold termina la partida).
      maybeEndMatch(state, events);

      // Regla del guiñote aragonés (vueltas 2+): en cuanto un equipo cruza
      // el umbral de cierre (cumulativeTeamPts > threshold), la mano
      // termina INMEDIATAMENTE. No se juegan las bazas restantes: las
      // cartas que queden en las manos se descartan y sus puntos NO
      // cuentan. La baza recién resuelta se registra como la última para
      // mantener coherencia con finishedTricks y TRICK_RESOLVED.
      //
      // Excepción: en IDAS (vuelta 1) NO hay cierre anticipado. Se juegan
      // las 10 cartas enteras aunque un equipo cruce 100 durante la mano;
      // el match sigue marcado como terminado en `state.matchEnded`, pero
      // el MATCH_OVER solo se difunde al final natural de la mano (lo hace
      // el servidor en `emitAfterChange` cuando phase='finished'). Esto
      // preserva la tradición de "en idas se va a la mesa completa".
      const matchCutShort = state.matchEnded && state.vuelta > 1;
      const handEnds = isLastTrick || matchCutShort;

      state.finishedTricks = [
        ...state.finishedTricks,
        {
          winner,
          plays: state.trick.plays,
          trickPoints: effectivePoints,
          hadLastTrick: handEnds,
        },
      ];
      events.push({ type: 'TRICK_RESOLVED', winner, points: effectivePoints, isLastTrick: handEnds });

      if (handEnds) {
        // Mano terminada — bien porque era la última baza, bien porque
        // el match se cerró anticipadamente y hay que parar ya.
        state.phase = 'finished';
        state.turn = null;
        events.push({
          type: 'HAND_FINISHED',
          trickPoints: { ...state.trickPoints },
          cantes: state.cantes,
          lastTrickBonus: state.rules.lastTrickBonus,
          score: state.score,
          vuelta: state.vuelta,
        });
      } else {
        state.phase = 'winnerWindow';
        state.turn = winner;
        state.lastWinner = winner;
      }
    } else {
      state.phase = 'follow';
      state.turn = nextSeat(seat);
    }
  } else if (action.type === 'SWAP_SEVEN') {
    if (state.phase !== 'winnerWindow') {
      throw new Error('SWAP_SEVEN solo legal en winnerWindow');
    }
    if (state.trumpCard === null) {
      throw new Error('SWAP_SEVEN solo durante la fase de robo (trumpCard no visible)');
    }
    // Regla del guiñote: el cambio del 7 solo procede si el triunfo es una
    // carta SUPERIOR al 7 (1, 3, 10, 11, 12). Cambiar el 7 por una carta
    // peor (2, 4, 5, 6, 7) no tiene sentido: el 7 captura la baza + vale
    // puntos, soltarlo por una carta inferior es empeorar.
    if (!canSwapSevenWithTrump(state.trumpCard)) {
      throw new Error(
        `SWAP_SEVEN no procede: el triunfo (${state.trumpCard.rank} de ${state.trumpCard.suit}) no es una carta superior al 7`,
      );
    }
    if (state.lastWinner === null) {
      throw new Error('SWAP_SEVEN requiere haber ganado una baza');
    }
    if (state.lastWinner !== seat && state.lastWinner !== partnerOf(seat)) {
      throw new Error('SWAP_SEVEN solo el ganador o su compañero');
    }
    const sevenId = `${state.trump}-7`;
    const idx = state.hands[seat]!.findIndex((c) => c.id === sevenId);
    if (idx < 0) {
      throw new Error(`El jugador no tiene el 7 de triunfo (${sevenId})`);
    }
    const taken = state.hands[seat]![idx]!;
    const newHand = state.hands[seat]!.slice();
    newHand[idx] = state.trumpCard;
    state.hands[seat] = newHand;
    state.trumpCard = taken;
    events.push({ type: 'SEVEN_SWAPPED', seat, taken, given: state.trumpCard });
  } else if (action.type === 'SING_CANTE') {
    // El cante se permite en winnerWindow (ventana tras una baza) o en
    // cualquier momento del juego (lead/follow/arrastre) siempre que se
    // haya ganado la última baza — la condición fina vive en
    // `legalActions.puedeCantar`. No imponemos aquí `trumpCard === null`
    // porque `legalActions` ya ofrece el cante durante el robo (lead
    // post-draw) cuando el ganador completa la pareja, y `apply` debe
    // ser coherente con eso.
    const canCanteInGame =
      state.phase === 'lead' || state.phase === 'follow' || state.phase === 'arrastre';
    if (state.phase !== 'winnerWindow' && !canCanteInGame) {
      throw new Error('SING_CANTE solo en winnerWindow o durante el juego');
    }
    const [a, b] = state.rules.cantes.pair;
    if (action.pair[0] !== a || action.pair[1] !== b) {
      throw new Error(`Cante pair inválido: ${action.pair}`);
    }
    const inHand = state.hands[seat]!.some((c) => c.suit === action.suit && c.rank === a) &&
      state.hands[seat]!.some((c) => c.suit === action.suit && c.rank === b);
    if (!inHand) throw new Error(`El jugador no tiene el par en mano: ${action.suit}`);
    if (state.cantes.some((c) => c.suit === action.suit)) {
      throw new Error(`El cante de ${action.suit} ya fue cantado`);
    }
    if (state.phase === 'winnerWindow') {
      if (state.lastWinner === null || (state.lastWinner !== seat && state.lastWinner !== partnerOf(seat))) {
        throw new Error('Cante en winnerWindow: solo el ganador o su compañero');
      }
    }
    const value = action.suit === state.trump ? state.rules.cantes.trumpValue : state.rules.cantes.value;
    const cante: Cante = { seat, team: teamOf(seat), suit: action.suit, pair: [a, b], value };
    state.cantes = [...state.cantes, cante];
    // El cante suma raw a `cumulativeTeamPts` (lo que ve el cliente) y a
    // `trickPoints` de la mano en curso. NO gestionamos Buenas/Malas
    // en el motor — solo puntos raw que se van sumando.
    const canteTeam: Team = teamOf(seat);
    state.trickPoints[canteTeam] = (state.trickPoints[canteTeam] ?? 0) + value;
    state.cumulativeTeamPts[canteTeam] = (state.cumulativeTeamPts[canteTeam] ?? 0) + value;
    maybeEndMatch(state, events);
    events.push({ type: 'CANTE_DECLARED', seat, team: cante.team, suit: cante.suit, pair: cante.pair, value });
    // Si el cante fue el que cruzó el umbral (o ya estábamos en matchEnded
    // por una suma anterior) Y estamos en vueltas 2+, cerramos la mano
    // aquí. Las bazas que falten no se juegan y los puntos de las cartas
    // restantes se descartan. En idas (vuelta 1) NO se cierra: la mano
    // sigue hasta que se jueguen las 10 bazas.
    // Importante: NO devolvemos; el flujo del apply debe seguir para que
    // se incremente `state.version` y se persistan los eventos en el log.
    if (state.matchEnded && state.vuelta > 1) {
      state.phase = 'finished';
      state.turn = null;
      events.push({
        type: 'HAND_FINISHED',
        trickPoints: { ...state.trickPoints },
        cantes: state.cantes,
        lastTrickBonus: state.rules.lastTrickBonus,
        score: state.score,
        vuelta: state.vuelta,
      });
    }
  } else if (action.type === 'PASS') {
    if (state.phase !== 'winnerWindow') {
      throw new Error('PASS solo en winnerWindow');
    }
    if (state.lastWinner === null) {
      throw new Error('PASS sin ganador previo');
    }
    const winner = state.lastWinner;
    const partner = partnerOf(winner);
    if (seat === winner) {
      // Pasa el turno al compañero.
      state.turn = partner;
    } else {
      // El compañero pasa. Se inicia el draw y se cierra la ventana.
      events.push(...draw(state, winner));
      state.phase = 'lead';
      state.turn = winner;
      state.leader = winner;
      state.trick = { plays: [] };
    }
  } else {
    const _exhaustive: never = action;
    throw new Error(`Acción desconocida: ${JSON.stringify(_exhaustive)}`);
  }

  state.version += 1;
  state.log.push(...events);
  return events;
}
