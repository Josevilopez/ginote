/**
 * E2E test del escenario reportado por el usuario en Sprint 2.15+:
 * un bot cambia el 7 por una carta peor (2 de bastos, etc.).
 *
 * Teoría (a verificar): el motor filtra bien en `apply.ts` y
 * `legalActions.ts`. La heurística del bot pasa por `legalActions`
 * y por tanto no debería emitir el SWAP_SEVEN. Si el test pasa,
 * el bug es de otro sitio (UI/server/cache de bundles).
 *
 * Sprint 2.15+: este test es para descartar regresiones en el
 * futuro. Si en algún momento este test empieza a fallar, sabes
 * que el motor ha cambiado algo en el filtro.
 */
import { describe, it, expect } from 'vitest';
import {
  apply,
  canSwapSevenWithTrump,
  legalActions,
  newHand,
  type Card,
  type Seat,
} from '@guinote/engine';
import { heuristicBotAction } from '@guinote/bots';
import { C, makeState } from './builders.js';

describe('Bot NO cambia el 7 por una carta peor (Sprint 2.15+)', () => {
  it('Regla: canSwapSevenWithTrump rechaza ranks 2, 4, 5, 6, 7 (los peores)', () => {
    expect(canSwapSevenWithTrump(C.bastos2)).toBe(false);  // rank 2
    expect(canSwapSevenWithTrump(C.bastos4)).toBe(false);  // rank 4
    expect(canSwapSevenWithTrump(C.bastos5)).toBe(false);  // rank 5
    expect(canSwapSevenWithTrump(C.bastos6)).toBe(false);  // rank 6
    expect(canSwapSevenWithTrump(C.bastos7)).toBe(false);  // rank 7 (mismo palo)
  });

  it('Bot ganador con trumpCard=2 de bastos y 7 en mano: NO hace SWAP_SEVEN, hace PASS', () => {
    // Estado: phase=winnerWindow, trump=bastos, trumpCard=bastos-2 (PEOR),
    // lastWinner=botSeat, turno del bot (que tiene el 7 de bastos en mano).
    const botSeat: Seat = 1;
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'bastos',
      trumpCard: C.bastos2,
      leader: 0,
      turn: botSeat,
      lastWinner: botSeat,
      hands: {
        0: [C.bastos7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [C.bastos7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1], // bot
        2: [],
        3: [],
      },
      // El bot sí tiene el 7 de bastos en mano (preparamos para que
      // SI el filtro dejara pasar, el bot lo haría).
    });
    const action = heuristicBotAction(s, botSeat);
    expect(action).not.toBeNull();
    // Si la lógica del motor es correcta, NO debe ser SWAP_SEVEN.
    expect(action?.type).not.toBe('SWAP_SEVEN');
    expect(action?.type).toBe('PASS');
  });

  it('Bot ganador con trumpCard=3 (SÍ elegible) y 7 en mano: SÍ hace SWAP_SEVEN', () => {
    // Caso opuesto: el triunfo SÍ es superior, el cambio es legal.
    const botSeat: Seat = 1;
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'bastos',
      trumpCard: C.bastos3,
      leader: 0,
      turn: botSeat,
      lastWinner: botSeat,
      hands: {
        0: [],
        1: [C.bastos7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        2: [],
        3: [],
      },
    });
    const action = heuristicBotAction(s, botSeat);
    expect(action).not.toBeNull();
    expect(action?.type).toBe('SWAP_SEVEN');
  });

  it('bot emite PASS si winnerWindow + trumpCard=peor + tiene el 7 (cualquier palo)', () => {
    // Iteramos sobre cada rango "peor" del triunfo y verificamos
    // que el bot hace PASS, no SWAP_SEVEN.
    const rankPeores: Array<{ card: Card; rank: number; label: string }> = [
      { card: C.bastos2, rank: 2, label: '2' },
      { card: C.bastos4, rank: 4, label: '4' },
      { card: C.bastos5, rank: 5, label: '5' },
      { card: C.bastos6, rank: 6, label: '6' },
      { card: C.bastos7, rank: 7, label: '7 (mismo palo)' },
    ];
    for (const t of rankPeores) {
      for (const botSeat of [0, 1, 2, 3] as const) {
        const s = makeState({
          phase: 'winnerWindow',
          trump: 'bastos',
          trumpCard: t.card,
          leader: 0,
          turn: botSeat,
          lastWinner: botSeat,
          hands: {
            0: [],
            1: [],
            2: [],
            3: [],
            [botSeat]: [C.bastos7, C.copas3, C.espadas7, C.bastos12, C.copas11, C.espadas1],
          },
        });
        const action = heuristicBotAction(s, botSeat);
        expect(action?.type, `bot=${botSeat} trump=${t.label}`).toBe('PASS');
      }
    }
  });
});
