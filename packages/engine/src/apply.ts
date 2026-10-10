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
      state.trickPoints[team] = (state.trickPoints[team] ?? 0) + effectivePoints;
      // Suma raw al acumulado del match: crece POR BAZA y se preserva
      // entre vueltas (vía continuation). Es la "puntuación actual" que
      // muestra la topbar.
      state.cumulativeTeamPts[team] = (state.cumulativeTeamPts[team] ?? 0) + effectivePoints;
      state.finishedTricks = [
        ...state.finishedTricks,
        {
          winner,
          plays: state.trick.plays,
          trickPoints: effectivePoints,
          hadLastTrick: isLastTrick,
        },
      ];
      events.push({ type: 'TRICK_RESOLVED', winner, points: effectivePoints, isLastTrick });

      if (isLastTrick) {
        // Mano terminada.
        const cantesPuntos: Record<Team, number> = { 0: 0, 1: 0 };
        for (const c of state.cantes) cantesPuntos[c.team] += c.value;
        state.trickPoints[0] += cantesPuntos[0];
        state.trickPoints[1] += cantesPuntos[1];
        // Suma de los cantes al acumulado raw (que el cliente muestra en
        // la cabecera como "marcador"). Antes solo sumaba los puntos de las
        // bazas baza a baza, así que el canto del 40 se quedaba fuera.
        state.cumulativeTeamPts[0] = (state.cumulativeTeamPts[0] ?? 0) + cantesPuntos[0];
        state.cumulativeTeamPts[1] = (state.cumulativeTeamPts[1] ?? 0) + cantesPuntos[1];
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

        // Puntuación de la partida de vueltas. Se acumula desde la primera
        // mano (idas). Si la partida ya terminó, no se sigue sumando.
        //
        // Regla del guiñote aragonés:
        //  - En cada mano, el equipo que saca > 50 puntos suma (puntos - 50)
        //    a sus buenas; el que saca ≤ 50 suma sus puntos a sus malas.
        //  - La partida termina en cuanto un equipo acumula > 50 buenas
        //    (sin esperar a que también supere 50 en malas — la condición
        //    anterior exigía ambas, lo que hacía imposible ganar a un
        //    equipo que siempre ganara la mano).
        if (state.rules.scoring && !state.matchEnded) {
          // cumulativeTeamPts ya se actualizó por baza arriba (no hace
          // falta sumar otra vez aquí).
          const nuevasBuenas: Record<0 | 1, number> = {
            0: state.score.buenas[0] ?? 0,
            1: state.score.buenas[1] ?? 0,
          };
          const nuevasMalas: Record<0 | 1, number> = {
            0: state.score.malas[0] ?? 0,
            1: state.score.malas[1] ?? 0,
          };
          for (const team of [0, 1] as const) {
            const teamPts = state.trickPoints[team] ?? 0;
            if (teamPts > 50) {
              nuevasBuenas[team] = (nuevasBuenas[team] ?? 0) + (teamPts - 50);
            } else if (teamPts > 0) {
              nuevasMalas[team] = (nuevasMalas[team] ?? 0) + teamPts;
            }
          }
          const nextScore = { buenas: nuevasBuenas, malas: nuevasMalas };
          state.score = nextScore;

          // Comprobar condición de victoria: cualquier equipo con
          // buenas > threshold gana y la partida termina. Si en idas
          // (vuelta 1) ya se supera el umbral, no se llega a jugar
          // vueltas; si en vueltas se supera, termina anticipadamente.
          const scoring = state.rules.scoring;
          if (scoring && scoring.mode === 'vueltas') {
            const t = scoring.threshold;
            for (const team of [0, 1] as const) {
              if ((nextScore.buenas[team] ?? 0) > t) {
                state.matchEnded = true;
                state.matchWinner = team;
                events.push({
                  type: 'MATCH_OVER',
                  winner: team,
                  score: nextScore,
                  vuelta: state.vuelta,
                });
                break;
              }
            }
          }
        }
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
    if (state.phase !== 'winnerWindow' && !(state.phase === 'follow' && state.trumpCard === null)) {
      throw new Error('SING_CANTE solo en winnerWindow o arrastre');
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
    events.push({ type: 'CANTE_DECLARED', seat, team: cante.team, suit: cante.suit, pair: cante.pair, value });
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
