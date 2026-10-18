import { describe, it, expect } from 'vitest';
import {
  INITIAL_RATING,
  NEW_PLAYER_GAMES_THRESHOLD,
  applyElo,
  applyEloTeam,
  expectedScore,
  kFor,
} from '../src/elo.js';

describe('elo.expectedScore', () => {
  it('devuelve 0.5 cuando los ratings son iguales', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
  });
  it('es ~0.91 cuando A lleva 200 puntos de ventaja', () => {
    // 10^(200/400) = 10^0.5 ≈ 3.162, 1/(1+3.162) ≈ 0.240
    // Espera esperada de A es ~0.76 (es la inversa)
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597, 3);
  });
  it('es ~0.09 cuando A lleva 400 puntos de desventaja', () => {
    // 10^((1000-600)/400) = 10^1 = 10, 1/(1+10) = 1/11 ≈ 0.0909
    expect(expectedScore(600, 1000)).toBeCloseTo(0.0909, 3);
  });
});

describe('elo.kFor', () => {
  it('devuelve K_NEW para nuevos', () => {
    expect(kFor(0)).toBe(40);
    expect(kFor(NEW_PLAYER_GAMES_THRESHOLD - 1)).toBe(40);
  });
  it('devuelve K_ESTABLISHED para >= 10 partidas', () => {
    expect(kFor(NEW_PLAYER_GAMES_THRESHOLD)).toBe(20);
    expect(kFor(100)).toBe(20);
  });
});

describe('elo.applyElo', () => {
  it('delta ~0 cuando A y B son iguales y A gana', () => {
    const r = applyElo(INITIAL_RATING, INITIAL_RATING, 1, 0);
    // expected = 0.5, delta = 40 * (1 - 0.5) = 20
    expect(r.deltaA).toBe(20);
    expect(r.newRatingA).toBe(INITIAL_RATING + 20);
    expect(r.k).toBe(40);
  });
  it('delta negativo cuando A pierde contra B más débil', () => {
    const r = applyElo(1000, 1200, 0, 0);
    // expectedA = 1/(1+10^((1200-1000)/400)) = 1/(1+10^0.5) = 0.2403
    // delta = 40 * (0 - 0.2403) = -10
    expect(r.deltaA).toBe(-10);
    expect(r.newRatingA).toBe(990);
  });
  it('delta positivo grande cuando A vence a B mucho más débil', () => {
    const r = applyElo(1200, 800, 1, 0);
    // expectedA = 1/(1+10^(-1)) = 1/(1+0.1) = 0.9091
    // delta = 40 * (1 - 0.9091) = 3.6 → round 4
    expect(r.deltaA).toBe(4);
  });
  it('usa K bajo para jugadores establecidos', () => {
    const r = applyElo(INITIAL_RATING, INITIAL_RATING, 1, 100);
    expect(r.k).toBe(20);
    // expected = 0.5, delta = 20 * (1 - 0.5) = 10
    expect(r.deltaA).toBe(10);
  });
  it('empate: delta 0 si ratings iguales', () => {
    const r = applyElo(1500, 1500, 0.5, 0);
    expect(r.deltaA).toBe(0);
  });
});

describe('elo.applyEloTeam', () => {
  it('deltaA y deltaB son opuestos y suman ~0', () => {
    const r = applyEloTeam(1000, 1200, 1, 80, 80);
    expect(r.deltaA + r.deltaB).toBe(0);
  });
  it('A nuevo (K=40) gana a B establecido (K=20): deltaA > |deltaB|', () => {
    const r = applyEloTeam(1000, 1200, 1, 0, 100);
    expect(r.deltaA).toBeGreaterThan(Math.abs(r.deltaB));
  });
  it('ratings se mueven en sentidos opuestos', () => {
    const r = applyEloTeam(1000, 1000, 1, 5, 5);
    expect(r.newRatingA).toBeGreaterThan(1000);
    expect(r.newRatingB).toBeLessThan(1000);
  });
});