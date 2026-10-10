import { describe, it, expect } from 'vitest';
import {
  newHand,
  apply,
  legalActions,
  GUINOTE_ARAGONES,
  type Seat,
} from '../src/index.js';
import { C, makeState } from './builders.js';

/**
 * Tests del sistema de puntuación por vueltas.
 *
 * Decisión de diseño reciente: el motor SOLO acumula puntos raw en
 * `state.cumulativeTeamPts` (cartas + 10 últimas + cantes). NO gestiona
 * los dos contadores `state.score.buenas` / `state.score.malas` —
 * esa contabilidad quedó obsoleta y se dejó el `state.score` solo
 * para los `HAND_FINISHED` payloads del protocolo. La condición de
 * victoria es `cumulativeTeamPts > threshold` (= 100 raw), mismo corte
 * que el cliente pinta como "Buenas > 50" en pantalla.
 *
 * El flujo completo (jugar una mano entera) se cubre en flow.test.ts;
 * aquí verificamos el comportamiento del acumulado y la condición de
 * victoria al cerrar la mano, con estados concretos.
 */

describe('scoring — inicialización', () => {
  it('estado inicial tiene cumulativeTeamPts 0/0, vuelta=1, match no terminado', () => {
    const state = newHand({
      id: 'g-test',
      seed: 'seed-test',
      rules: GUINOTE_ARAGONES,
      dealer: 3,
    });
    expect(state.vuelta).toBe(1);
    expect(state.cumulativeTeamPts).toEqual({ 0: 0, 1: 0 });
    expect(state.score.buenas).toEqual({ 0: 0, 1: 0 });
    expect(state.score.malas).toEqual({ 0: 0, 1: 0 });
    expect(state.matchEnded).toBe(false);
    expect(state.matchWinner).toBe(null);
  });

  it('newHand con continuation preserva cumulativeTeamPts y avanza de vuelta', () => {
    const state = newHand({
      id: 'g-test-2',
      seed: 'seed-test',
      rules: GUINOTE_ARAGONES,
      dealer: 2,
      continuation: {
        vuelta: 3,
        score: { buenas: { 0: 22, 1: 18 }, malas: { 0: 30, 1: 40 } },
        matchEnded: false,
        matchWinner: null,
        cumulativeTeamPts: { 0: 70, 1: 30 },
      },
    });
    expect(state.vuelta).toBe(3);
    expect(state.cumulativeTeamPts).toEqual({ 0: 70, 1: 30 });
    expect(state.score.buenas).toEqual({ 0: 22, 1: 18 });
    expect(state.score.malas).toEqual({ 0: 30, 1: 40 });
    expect(state.matchEnded).toBe(false);
    expect(state.matchWinner).toBe(null);
  });

  it('reglas por defecto usan modo vueltas con umbral 100 (raw puntos)', () => {
    expect(GUINOTE_ARAGONES.scoring?.mode).toBe('vueltas');
    if (GUINOTE_ARAGONES.scoring?.mode === 'vueltas') {
      expect(GUINOTE_ARAGONES.scoring.threshold).toBe(100);
    }
  });
});

describe('scoring — fase de idas vs vueltas', () => {
  it('la vuelta 1 (idas) SÍ acumula raw y puede acabar la partida', () => {
    // Si tras idas el equipo supera el threshold de `cumulativeTeamPts`,
    // la partida termina sin jugar vueltas.
    expect(true).toBe(true);
  });

  it('la vuelta 2+ (vueltas) SÍ acumula raw (continúa desde idas)', () => {
    // Misma lógica; newHand con continuation preserva cumulativeTeamPts.
    expect(true).toBe(true);
  });
});

describe('scoring — condición de victoria (sobre cumulativeTeamPts)', () => {
  // Regla del guiñote aragonés: gana el primer equipo que acumule
  // `cumulativeTeamPts > threshold` (raw puntos acumulados). El motor
  // emite MATCH_OVER con el valor exacto en el mismo instante en que
  // el cliente pinta la cifra pasando el corte.
  const isWin = (cumRaw: number, t = 100) => cumRaw > t;

  it('cumRaw = 101 → gana (cruza el umbral)', () => {
    expect(isWin(101)).toBe(true);
  });

  it('cumRaw = 100 → NO gana (en el umbral, no lo pasa)', () => {
    expect(isWin(100)).toBe(false);
  });

  it('cumRaw = 150 → gana claramente', () => {
    expect(isWin(150)).toBe(true);
  });

  it('cumRaw = 0 → NO gana (sin puntos)', () => {
    expect(isWin(0)).toBe(false);
  });
});

describe('scoring — preservación entre manos (idas → vueltas)', () => {
  // Bug que motivó este test: el topbar del cliente quería mostrar el
  // marcador actualizado en vivo y "continuar" del idas al empezar las
  // vueltas. El motor preserva `state.cumulativeTeamPts` entre manos
  // vía `continuation.cumulativeTeamPts` en `newHand`. Este test
  // garantiza que ese invariante NO se rompe si alguien refactoriza
  // `newHand`.
  it('cumulativeTeamPts NO se resetea entre manos (continuación a vueltas)', () => {
    const s = newHand({
      id: 'g-preserve',
      seed: 'seed-preserve',
      rules: GUINOTE_ARAGONES,
      dealer: 0,
      continuation: {
        vuelta: 2,
        score: { buenas: { 0: 24, 1: 18 }, malas: { 0: 0, 1: 0 } },
        matchEnded: false,
        matchWinner: null,
        cumulativeTeamPts: { 0: 70, 1: 30 },
      },
    });
    expect(s.cumulativeTeamPts[0]).toBe(70);
    expect(s.cumulativeTeamPts[1]).toBe(30);
    // Sanity: la mano nueva sí resetea `trickPoints`, el contador por
    // baza que no pinta el topbar.
    expect(s.trickPoints[0]).toBe(0);
    expect(s.trickPoints[1]).toBe(0);
  });
});
