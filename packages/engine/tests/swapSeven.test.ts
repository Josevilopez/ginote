import { describe, it, expect } from 'vitest';
import { apply, legalActions } from '../src/index.js';
import { C, makeState } from './builders.js';

describe('Cambio del 7 de triunfo', () => {
  it('es legal solo para el ganador y su compañero, solo en draw, solo si tienen el 7 y el triunfo es superior', () => {
    // Estado: phase=winnerWindow, trump=oros, trumpCard=or12 (Rey, superior
    // al 7 → cumple la regla nueva), lastWinner=0. Turno de seat 2
    // (compañero de 0). Seat 2 tiene oros-7.
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros12,
      leader: 0,
      turn: 2,
      lastWinner: 0,
      hands: {
        0: [],
        1: [],
        2: [C.oros7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        3: [],
      },
    });
    const actions = legalActions(s, 2);
    expect(actions.some((a) => a.type === 'SWAP_SEVEN')).toBe(true);
  });

  it('NO es legal para el oponente', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros12,
      leader: 0,
      turn: 1, // oponente
      lastWinner: 0,
      hands: {
        0: [],
        1: [C.oros7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 1);
    expect(actions.some((a) => a.type === 'SWAP_SEVEN')).toBe(false);
  });

  it('NO es legal en arrastre (trumpCard=null)', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: null,
      leader: 0,
      turn: 0,
      lastWinner: 0,
      hands: {
        0: [C.oros7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 0);
    expect(actions.some((a) => a.type === 'SWAP_SEVEN')).toBe(false);
  });

  it('NO es legal si el triunfo NO es una carta superior (1, 3, 10, 11, 12)', () => {
    // trumpCard es 5 de oros → rango 5, NO está en el set de superiores.
    // Aunque el ganador tenga el 7, no debe ofrecerse SWAP_SEVEN.
    for (const bad of [C.oros5, C.oros4, C.oros6, C.oros2, C.oros7]) {
      const s = makeState({
        phase: 'winnerWindow',
        trump: 'oros',
        trumpCard: bad,
        leader: 0,
        turn: 0,
        lastWinner: 0,
        hands: {
          0: [C.oros7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
          1: [],
          2: [],
          3: [],
        },
      });
      const actions = legalActions(s, 0);
      expect(actions.some((a) => a.type === 'SWAP_SEVEN')).toBe(false);
    }
  });

  it('aplicar SWAP_SEVEN intercambia el 7 por la trumpCard visible', () => {
    // trumpCard es una carta de oros DISTINTA del 7 (en la realidad la trumpCard
    // es la última del mazo y puede ser cualquier carta del palo de triunfo).
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros12,
      leader: 0,
      turn: 0,
      lastWinner: 0,
      hands: {
        0: [C.oros7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    apply(s, { type: 'SWAP_SEVEN' });
    // El 7 ya no está en la mano de seat 0; trumpCard ahora es el 7.
    expect(s.hands[0]!.some((c) => c.id === 'oros-7')).toBe(false);
    expect(s.trumpCard).not.toBeNull();
    expect(s.trumpCard!.id).toBe('oros-7');
  });

  it('aplicar SWAP_SEVEN lanza error si el triunfo NO es superior', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros5, // 5 → no es superior al 7
      leader: 0,
      turn: 0,
      lastWinner: 0,
      hands: {
        0: [C.oros7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    expect(() => apply(s, { type: 'SWAP_SEVEN' })).toThrow(/SWAP_SEVEN no procede/);
  });
});
