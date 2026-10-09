import type { Card, Seat } from './types.js';
import type { GameState, Play } from './state.js';
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
  readonly trump: GameState['trump'];
  readonly trumpCard: Card | null; // visible en draw
  readonly hand: readonly Card[]; // tu mano
  readonly handCounts: Record<Seat, number>; // cuántas tiene cada uno (público)
  readonly trick: readonly Play[];
  readonly finishedTricks: readonly { winner: Seat; points: number; plays: readonly Play[] }[];
  readonly trickPoints: Record<0 | 1, number>;
  readonly cantes: readonly { team: 0 | 1; suit: GameState['trump']; value: number }[];
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
    trump: state.trump,
    trumpCard: state.trumpCard,
    hand: state.hands[seat]!.slice(),
    handCounts,
    trick: state.trick.plays.slice(),
    finishedTricks: state.finishedTricks.map((t) => ({
      winner: t.winner,
      points: t.trickPoints,
      plays: t.plays,
    })),
    trickPoints: { ...state.trickPoints },
    cantes: state.cantes.map((c) => ({ team: c.team, suit: c.suit, value: c.value })),
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
