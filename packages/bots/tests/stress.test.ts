import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  apply,
  GUINOTE_ARAGONES,
  legalActions,
  newHand,
  nextHandSetup,
  type Action,
  type GameState,
  type Seat,
} from '@guinote/engine';
import { botAction, botThinkDelayMs, BOT_THINK_MAX_MS, BOT_THINK_MIN_MS, type BotLevel } from '../src/index.js';

/**
 * S2-10 — Test de estrés: partidas completas bot contra bot (hasta que un
 * equipo pasa de 100) comprobando en CADA acción que el bot solo elige
 * acciones legales y que el motor no lanza, y al final de cada mano
 * completa que se conservan las 40 cartas y los puntos (120 + 10 de
 * últimas + cantes).
 *
 * Nº de partidas por modo: `STRESS_GAMES` (por defecto 300 para que
 * `npm test` vaya rápido). Ejecución completa (10 000 por modo):
 *   PowerShell:  $env:STRESS_GAMES=10000; npm run stress -w @guinote/bots
 *   bash:        STRESS_GAMES=10000 npm run stress -w @guinote/bots
 *
 * Determinista: semilla de reparto por partida y `Math.random` sustituido
 * por un PRNG con semilla (el bot nivel 1 lo usa), así un fallo se puede
 * reproducir con la semilla que aparece en el mensaje.
 */
const GAMES = Number(process.env.STRESS_GAMES ?? 300);

/** mulberry32: PRNG pequeño y suficiente para tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);
const CARD_POINTS_TOTAL = 120;

/** Juega una partida completa. Devuelve el equipo ganador y nº de manos. */
function playPartida(seed: string, levels: Record<Seat, BotLevel>): { winner: 0 | 1; hands: number } {
  let state: GameState = newHand({ id: seed, seed: `${seed}-h1`, rules: GUINOTE_ARAGONES, dealer: 0 });
  let hands = 1;
  for (;;) {
    let guard = 500;
    while (state.phase !== 'finished') {
      if (guard-- <= 0) throw new Error(`[${seed}] mano ${hands} no termina (fase ${state.phase})`);
      const seat = state.turn;
      if (seat === null) throw new Error(`[${seed}] turn=null en fase ${state.phase}`);
      const legal = legalActions(state, seat);
      const action = botAction(state, seat, levels[seat]);
      if (!action) throw new Error(`[${seed}] bot L${levels[seat]} seat ${seat} sin acción en fase ${state.phase}`);
      if (!legal.some((a) => sameAction(a, action))) {
        throw new Error(`[${seed}] acción ILEGAL L${levels[seat]} seat ${seat}: ${JSON.stringify(action)} (fase ${state.phase})`);
      }
      try {
        apply(state, action);
      } catch (err) {
        throw new Error(`[${seed}] el motor rechazó ${JSON.stringify(action)}: ${(err as Error).message}`);
      }
    }

    // Invariantes de la mano, solo si se jugó entera (en vueltas se puede
    // cortar al pasar de 100).
    const tricks = state.finishedTricks;
    if (tricks.length === 10 && tricks[9]!.isLastTrick) {
      const cards = new Set(tricks.flatMap((t) => t.plays.map((p) => p.card.id)));
      if (cards.size !== 40) throw new Error(`[${seed}] mano ${hands}: ${cards.size} cartas distintas jugadas (esperado 40)`);
      const cantes = state.cantes.reduce((s, c) => s + c.value, 0);
      const pts = state.trickPoints[0] + state.trickPoints[1];
      const expected = CARD_POINTS_TOTAL + state.rules.lastTrickBonus + cantes;
      if (pts !== expected) throw new Error(`[${seed}] mano ${hands}: puntos ${pts} ≠ ${expected}`);
    }

    if (state.matchEnded) {
      if (state.matchWinner === null) throw new Error(`[${seed}] partida terminada sin ganador`);
      return { winner: state.matchWinner, hands };
    }
    if (hands > 40) throw new Error(`[${seed}] más de 40 manos sin terminar la partida`);

    // Siguiente mano de la misma partida (misma regla que el server).
    hands++;
    const next = nextHandSetup(state);
    state = newHand({ id: seed, seed: `${seed}-h${hands}`, rules: GUINOTE_ARAGONES, ...next });
  }
}

const MODES: Array<{ name: string; team0: BotLevel; team1: BotLevel }> = [
  { name: 'L1 vs L1', team0: 1, team1: 1 },
  { name: 'L2 vs L2', team0: 2, team1: 2 },
  { name: 'L1 vs L2', team0: 1, team1: 2 },
];

describe(`S2-10 estrés: ${GAMES} partidas bot contra bot por modo`, () => {
  let restore: (() => void) | null = null;
  beforeAll(() => {
    const rng = mulberry32(20261018);
    const spy = vi.spyOn(Math, 'random').mockImplementation(rng);
    restore = () => spy.mockRestore();
  });
  afterAll(() => restore?.());

  for (const mode of MODES) {
    it(`${mode.name}: sin acciones ilegales, sin cuelgues, invariantes OK`, () => {
      const levels: Record<Seat, BotLevel> = { 0: mode.team0, 1: mode.team1, 2: mode.team0, 3: mode.team1 };
      const wins = { 0: 0, 1: 0 };
      let hands = 0;
      for (let i = 0; i < GAMES; i++) {
        const r = playPartida(`stress-${mode.name.replace(/ /g, '')}-${i}`, levels);
        wins[r.winner]++;
        hands += r.hands;
      }
      expect(wins[0] + wins[1]).toBe(GAMES);
      // eslint-disable-next-line no-console
      console.log(`[stress] ${mode.name}: ${GAMES} partidas, ${hands} manos · gana eq.0 ${wins[0]} / eq.1 ${wins[1]}`);
      if (mode.team0 !== mode.team1 && GAMES >= 100) {
        // Sanidad: el nivel 2 (equipo 1) debe ganar claramente al nivel 1.
        expect(wins[1] / GAMES).toBeGreaterThan(0.6);
      }
    });
  }

  it('el retardo de "pensar" está siempre entre 600 y 1500 ms', () => {
    for (const r of [0, 0.25, 0.5, 0.999999]) {
      const ms = botThinkDelayMs(() => r);
      expect(ms).toBeGreaterThanOrEqual(BOT_THINK_MIN_MS);
      expect(ms).toBeLessThanOrEqual(BOT_THINK_MAX_MS);
    }
  });
});
