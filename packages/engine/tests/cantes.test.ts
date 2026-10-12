import { describe, it, expect } from 'vitest';
import { apply, card, legalActions } from '../src/index.js';
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

  it('en arrastre, SÓLO el ganador de la baza (o su compañero) puede cantar', () => {
    // trumpCard=null → fase de arrastre. Tiene Rey+Sota de copas. Pero
    // lastWinner=1 (oponente), así que seat 0 NO puede cantar aunque
    // tenga el par en mano.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null, // arrastre
      leader: 0,
      turn: 0,
      lastWinner: 1, // el oponente ganó la última baza
      hands: {
        0: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 0);
    expect(actions.some((a) => a.type === 'SING_CANTE')).toBe(false);

    // Misma mano, pero ahora lastWinner=0 (el jugador ganó la baza) → SÍ puede.
    s.lastWinner = 0;
    const actionsWin = legalActions(s, 0);
    expect(actionsWin.some((a) => a.type === 'SING_CANTE')).toBe(true);

    // Misma mano, lastWinner=2 (el compañero ganó). Seat 0 puede cantar por ser compañero.
    s.lastWinner = 2;
    const actionsPartner = legalActions(s, 0);
    expect(actionsPartner.some((a) => a.type === 'SING_CANTE')).toBe(true);
  });

  it('el ganador que roba la carta que completa la pareja puede cantar en su turno de lead post-draw', () => {
    // Repro del bug que reportaste: tras la baza, winnerWindow →
    // partner pasa → draw() → phase='lead', turn=winner. Si en ese robo
    // el ganador ha completado la pareja de cante, debe poder cantar
    // AHORA, sin esperar al 'follow' del siguiente turno. Antes del fix
    // el motor solo listaba SING_CANTE en 'follow'.
    const s = makeState({
      phase: 'lead',
      trump: 'oros',
      trumpCard: null, // arrastre (ya se tomó el triunfo visible en bazas anteriores)
      leader: 0,
      turn: 0,        // ganador, llevando la nueva baza
      lastWinner: 0,
      hands: {
        0: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    const actions = legalActions(s, 0);
    expect(actions.some((a) => a.type === 'SING_CANTE')).toBe(true);
    expect(() => apply(s, { type: 'SING_CANTE', suit: 'copas', pair: [10, 12] })).not.toThrow();
  });

  it('el ganador puede cantar en lead post-draw aunque el triunfo SIGA visible (todavía hay cartas)', () => {
    // Caso del bug que reportaste en producción: el escenario típico
    // durante el robo en mano temprana es que `phase='lead'` y
    // `trumpCard !== null` (todavía quedan cartas en el mazo y el
    // triunfo sigue visible). El ganador (o su compañero) de la baza
    // anterior ha completado la pareja y debe poder cantar. `legalActions`
    // ya lo ofrecía, pero `apply` lo rechazaba porque requería
    // `trumpCard === null`. Ahora ambos están alineados.
    const s = makeState({
      phase: 'lead',
      trump: 'oros',
      trumpCard: C.oros3, // todavía hay cartas en el mazo (no es arrastre)
      leader: 0,
      turn: 0,
      lastWinner: 0,
      deck: [card('oros', 7), card('oros', 4)], // cartas restantes
      hands: {
        0: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        1: [],
        2: [],
        3: [],
      },
    });
    expect(legalActions(s, 0).some((a) => a.type === 'SING_CANTE')).toBe(true);
    expect(() => apply(s, { type: 'SING_CANTE', suit: 'copas', pair: [10, 12] })).not.toThrow();
  });

  it('el cante guarda el seat que cantó (necesario para anunciarlo por pantalla)', () => {
    // El cliente pinta "Bot X canta 40 en Oros", así que el estado del
    // cante debe recordar el seat concreto, no solo el team.
    const s = makeState({
      phase: 'winnerWindow',
      trump: 'oros',
      trumpCard: C.oros7,
      leader: 0,
      turn: 2, // el COMPAÑERO (de 0) gana la baza y ahora le toca cantar
      lastWinner: 0,
      hands: {
        0: [],
        1: [],
        2: [C.copas10, C.copas12, C.espadas7, C.bastos12, C.copas11, C.espadas1],
        3: [],
      },
    });
    apply(s, { type: 'SING_CANTE', suit: 'copas', pair: [10, 12] });
    expect(s.cantes).toHaveLength(1);
    expect(s.cantes[0]?.seat).toBe(2);
    expect(s.cantes[0]?.team).toBe(0);
  });
});
