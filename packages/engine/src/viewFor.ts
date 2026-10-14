import type { Card, Seat } from './types.js';
import type { GameState, Play } from './state.js';
import type { RulesConfig } from './rules.js';
import { SEATS, partnerOf } from './types.js';

/**
 * Vista del estado para un jugador concreto.
 *
 * El servidor NUNCA envía la mano de otro jugador ni el contenido del mazo.
 * Esta es la única función que produce un payload para el cliente.
 *
 * `playedBySeat` es el historial de cartas que cada seat ha jugado en bazas
 * ya resueltas. Es público porque ya se han visto en mesa — es la "memoria"
 * que un jugador real llevaría en la cabeza.
 */
export interface PlayerView {
  readonly you: Seat;
  readonly phase: GameState['phase'];
  readonly turn: Seat | null;
  readonly leader: Seat;
  /** Asiento que ha repartido esta mano. Necesario para que el cliente
   *  pueda anticipar quién reparte la siguiente sin re-derivar la rotación
   *  (el motor y la UI comparten la misma regla vía `nextDealer`). */
  readonly dealer: Seat;
  readonly trump: GameState['trump'];
  readonly trumpCard: Card | null; // visible en draw
  /**
   * Configuración de reglas que aplica a esta partida. La envía el servidor
   * para que el cliente (frontend) NO tenga que hardcodear la `RulesConfig`
   * (por ejemplo `GUINOTE_ARAGONES`). Si en una sala se juega una variante
   * regional con reglas distintas, el cliente recibe esa variante aquí y
   * `legalPlaysFromView` usa estos mismos flags.
   */
  readonly rules: RulesConfig;
  readonly hand: readonly Card[]; // tu mano
  readonly handCounts: Record<Seat, number>; // cuántas tiene cada uno (público)
  readonly trick: readonly Play[];
  readonly finishedTricks: readonly { winner: Seat; points: number; plays: readonly Play[] }[];
  readonly trickPoints: Record<0 | 1, number>;
  readonly cantes: readonly { seat: Seat; team: 0 | 1; suit: GameState['trump']; value: number }[];
  readonly lastWinner: Seat | null;
  readonly partner: Seat;
  readonly lastTrickBonus: number;
  // ─── Estado de la partida de vueltas ───
  readonly vuelta: number;
  readonly score: {
    readonly buenas: Record<0 | 1, number>;
    readonly malas: Record<0 | 1, number>;
  };
  /** Suma raw de teamPts de cada mano (idas + vueltas). */
  readonly cumulativeTeamPts: Record<0 | 1, number>;
  readonly matchEnded: boolean;
  readonly matchWinner: 0 | 1 | null;
  readonly version: number;
}

export function viewFor(state: GameState, seat: Seat): PlayerView {
  const handCounts: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const s of SEATS) handCounts[s] = state.hands[s]!.length;

  return {
    you: seat,
    phase: state.phase,
    turn: state.turn,
    leader: state.leader,
    dealer: state.dealer,
    trump: state.trump,
    trumpCard: state.trumpCard,
    rules: state.rules,
    hand: state.hands[seat]!.slice(),
    handCounts,
    trick: state.trick.plays.slice(),
    finishedTricks: state.finishedTricks.map((t) => ({
      winner: t.winner,
      points: t.trickPoints,
      plays: t.plays,
    })),
    trickPoints: { ...state.trickPoints },
    cantes: state.cantes.map((c) => ({ seat: c.seat, team: c.team, suit: c.suit, value: c.value })),
    lastWinner: state.lastWinner,
    partner: partnerOf(seat),
    lastTrickBonus: state.rules.lastTrickBonus,
    vuelta: state.vuelta,
    score: {
      buenas: { ...state.score.buenas },
      malas: { ...state.score.malas },
    },
    cumulativeTeamPts: { ...state.cumulativeTeamPts },
    matchEnded: state.matchEnded,
    matchWinner: state.matchWinner,
    version: state.version,
  };
}
