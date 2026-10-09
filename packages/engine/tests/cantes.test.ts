import { describe, it, expect } from 'vitest';
import { apply, legalActions } from '../src/index.js';
import { C, makeState } from './builders.js';

describe('Cantes', () => {
  it('20 puntos en palo normal', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros7,
      leader: 0,
      turn: 0,
      lastWinner: 0,
      hands: {
        0: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 0);
    const cante = actions.find((a) => a.type === 'SING_CANTE');
    expect(cante).toBeDefined();
    if (cante && cante.type === 'SING_CANTE') {
      // aplicamos
      apply(s, { type: 'SING_CANTE', suit: 'copas', pair: [10, 12] });
      expect(s.cantes[0]?.value).toBe(20);
      expect(s.cantes[0]?.suit).toBe('copas');
    }
  });

  it('40 puntos en palo de triunfo', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros7,
      leader: 0,
      turn: 0,
      lastWinner: 0,
      hands: {
        0: [C.oros10, C.oros12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 0);
    const cante = actions.find((a) => a.type === 'SING_CANTE');
    expect(cante).toBeDefined();
    if (cante && cante.type === 'SING_CANTE') {
      apply(s, { type: 'SING_CANTE', suit: 'oros', pair: [10, 12] });
      expect(s.cantes[0]?.value).toBe(40);
    }
  });

  it('el compañero del ganador también puede cantar en winnerWindow', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros7,
      leader: 0,
      turn: 2, // compañero de 0
      lastWinner: 0,
      hands: {
        0: [],
        1: [],
        2: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        3: [],
      },
    });
    const actions = legalActions(s, 2);
    expect(actions.some((a) => a.type === 'SING_CANTE')).toBe(true);
  });

  it('el oponente NO puede cantar en winnerWindow', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros7,
      leader: 0,
      turn: 1, // oponente
      lastWinner: 0,
      hands: {
        0: [],
        1: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 1);
    expect(actions.some((a) => a.type === 'SING_CANTE')).toBe(false);
  });

  it('no se puede cantar dos veces el mismo palo', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros7,
      leader: 0,
      turn: 0,
      lastWinner: 0,
      cantes: [{ team: 0, suit: 'copas', pair: [10, 12], value: 20 }],
      hands: {
        0: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 0);
    const cantes = actions.filter((a) => a.type === 'SING_CANTE');
    expect(cantes.some((a) => a.type === 'SING_CANTE' && a.suit === 'copas')).toBe(false);
  });
});
