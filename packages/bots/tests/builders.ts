import {
  GUINOTE_ARAGONES,
  newHand,
  card,
  type Card,
  type GameState,
  type Phase,
  type Play,
  type Seat,
  type Suit,
} from '@guinote/engine';

/**
 * Helper para construir estados a mano en tests del bot. Mismo API que
 * `packages/engine/tests/builders.ts`, copiado aquí para que el package
 * `bots` no dependa de los tests del engine.
 */
export function makeState(opts: {
  phase?: Phase;
  hands?: Record<Seat, Card[]>;
  trick?: readonly Play[];
  leader?: Seat;
  turn?: Seat | null;
  trump?: Suit;
  trumpCard?: Card | null;
  lastWinner?: Seat | null;
  deck?: Card[];
  dealer?: Seat;
  cantes?: GameState['cantes'];
  trickPoints?: GameState['trickPoints'];
} = {}): GameState {
  const base = newHand({
    id: 'g-test',
    seed: 'seed-test',
    rules: GUINOTE_ARAGONES,
    dealer: opts.dealer ?? 3,
  });
  return {
    ...base,
    phase: opts.phase ?? base.phase,
    trick: opts.trick ? { plays: opts.trick } : { plays: [] },
    hands: opts.hands ?? base.hands,
    leader: opts.leader ?? base.leader,
    turn: opts.turn === undefined ? base.turn : opts.turn,
    trump: opts.trump ?? base.trump,
    trumpCard: opts.trumpCard === undefined ? base.trumpCard : opts.trumpCard,
    lastWinner: opts.lastWinner === undefined ? null : opts.lastWinner,
    deck: opts.deck ?? base.deck,
    cantes: opts.cantes ?? [],
    trickPoints: opts.trickPoints ?? { 0: 0, 1: 0 },
  };
}

/** Cartas de ejemplo para tests. Mismo set que el builder del engine. */
export const C = {
  oros1: card('oros', 1),
  oros3: card('oros', 3),
  oros12: card('oros', 12),
  oros10: card('oros', 10),
  oros11: card('oros', 11),
  oros7: card('oros', 7),
  oros6: card('oros', 6),
  oros5: card('oros', 5),
  oros4: card('oros', 4),
  oros2: card('oros', 2),
  copas1: card('copas', 1),
  copas3: card('copas', 3),
  copas12: card('copas', 12),
  copas10: card('copas', 10),
  copas11: card('copas', 11),
  copas7: card('copas', 7),
  espadas1: card('espadas', 1),
  espadas3: card('espadas', 3),
  espadas12: card('espadas', 12),
  espadas10: card('espadas', 10),
  espadas7: card('espadas', 7),
  espadas6: card('espadas', 6),
  bastos1: card('bastos', 1),
  bastos3: card('bastos', 3),
  bastos12: card('bastos', 12),
  bastos10: card('bastos', 10),
  bastos7: card('bastos', 7),
  bastos6: card('bastos', 6),
  bastos5: card('bastos', 5),
  bastos4: card('bastos', 4),
  bastos2: card('bastos', 2),
};
