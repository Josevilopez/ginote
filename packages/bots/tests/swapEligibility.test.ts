import { describe, it, expect } from 'vitest';
import {
  apply,
  canSwapSevenWithTrump,
  GUINOTE_ARAGONES,
  legalActions,
  newHand,
  SEATS,
  type GameState,
  type Seat,
} from '@guinote/engine';
import { heuristicBotAction } from '../src/index.js';
import { C, makeState } from '../../engine/tests/builders.js';

describe('Bots NO cambian el 7 por una carta peor', () => {
  it('canSwapSevenWithTrump rechaza ranks peores (2, 4, 5, 6, 7, 8, 9)', () => {
    const rejected: typeof C.oros2[] = [
      C.oros2,
      C.oros4,
      C.oros5,
      C.oros6,
      C.oros7,
    ];
    for (const bad of rejected) {
      expect(canSwapSevenWithTrump(bad)).toBe(false);
    }
  });

  it('canSwapSevenWithTrump acepta ranks superiores (1, 3, 10, 11, 12)', () => {
    const accepted = [C.oros1, C.oros3, C.oros10, C.oros11, C.oros12];
    for (const good of accepted) {
      expect(canSwapSevenWithTrump(good)).toBe(true);
    }
  });

  it('legalActions NO emite SWAP_SEVEN si el triunfo es el 2 de oros', () => {
    // Estado: phase=winnerWindow, trump=oros, trumpCard=oros2 (PEOR que
    // el 7), lastWinner=0, turno de seat 2 (compañero de 0). Seat 2
    // tiene el 7 de oros en mano.
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros2,
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
    expect(actions.some((a) => a.type === 'SWAP_SEVEN')).toBe(false);
  });

  it('heuristicBotAction NO emite SWAP_SEVEN si el triunfo es el 2 de oros', () => {
    // Mismo estado que el test anterior pero llamando a la heurística
    // del bot. Esta es la ruta crítica que usa el servidor cuando es
    // un bot quien debe actuar.
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros2,
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
    const action = heuristicBotAction(s, 2);
    // Sin SWAP_SEVEN disponible, el bot debería pasar (PASS) para
    // cerrar la ventana del ganador.
    expect(action).not.toBeNull();
    expect(action?.type).toBe('PASS');
  });

  it('apply lanza error si llega SWAP_SEVEN con triunfo peor (defensa en profundidad)', () => {
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros2,
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
