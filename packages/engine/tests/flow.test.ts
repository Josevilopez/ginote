import { describe, it, expect } from 'vitest';
import {
  apply,
  legalActions,
  newHand,
  GUINOTE_ARAGONES,
  SEATS,
  nextSeat,
  type Card,
  type Seat,
} from '../src/index.js';

interface BotSeat {
  seat: Seat;
  play(): void;
}

/**
 * Simula una mano completa con bots random-legal. Útil para verificar que
 * el flujo entero (reparto → bazas → ganador → robo → cambio de fase → 10 de
 * últimas → fin de mano) termina sin lanzar excepciones y produce un resultado
 * coherente.
 */
function simulateHand(seed: string): {
  tricks: number;
  points: { 0: number; 1: number };
  cantes: number;
  handFinished: boolean;
} {
  const state = newHand({ id: 'sim', seed, rules: GUINOTE_ARAGONES, dealer: 3 });
  const bots: BotSeat[] = SEATS.map((seat) => ({ seat, play: () => playRandom(state, seat) }));
  let turns = 0;
  const maxTurns = 1000;

  while (state.phase !== 'finished' && turns < maxTurns) {
    const seat = state.turn;
    if (seat === null) throw new Error('turn null en mano no terminada');
    if (state.phase === 'winnerWindow') {
      // Si soy el ganador o compañero, paso. Como winnerWindow alterna, aquí
      // siempre pasaremos al final.
      apply(state, { type: 'PASS' });
    } else {
      // lead o follow: jugar carta legal.
      const actions = legalActions(state, seat);
      const play = actions.find((a) => a.type === 'PLAY_CARD');
      if (!play) throw new Error(`Bot ${seat} sin acción legal en ${state.phase}`);
      apply(state, play);
    }
    turns++;
  }

  if (state.phase !== 'finished') throw new Error(`No terminó tras ${turns} turnos`);

  return {
    tricks: state.finishedTricks.length,
    points: { ...state.trickPoints },
    cantes: state.cantes.length,
    handFinished: true,
  };
}

function playRandom(state: ReturnType<typeof newHand>, seat: Seat): void {
  const actions = legalActions(state, seat);
  const play = actions.find((a) => a.type === 'PLAY_CARD');
  if (play) apply(state, play);
}

describe('Flujo de una mano completa', () => {
  it('simulación 1: termina con 10 bazas y suma coherente', () => {
    const r = simulateHand('sim-1');
    expect(r.handFinished).toBe(true);
    expect(r.tricks).toBe(10);
    const total = r.points[0] + r.points[1];
    // Puntos totales en juego: cartas 30 (As+3+Rey+Sota+Caballo) + 10 últimas = 40.
    // + cantes (0 o 20 o 40 por equipo). Puede ser 40 + cantes.
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it('simulaciones múltiples: todas terminan sin excepción', () => {
    for (let i = 0; i < 20; i++) {
      const r = simulateHand(`sim-${i}`);
      expect(r.handFinished).toBe(true);
      expect(r.tricks).toBe(10);
    }
  });
});
