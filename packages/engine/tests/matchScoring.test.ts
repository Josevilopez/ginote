import { describe, expect, it } from 'vitest';
import { FIRST_TO_3, firstToN, GUINOTE_ARAGONES, newHand, nextDealer, nextHandSetup } from '../src/index.js';

describe('S2-06 MatchScoring — primero a N partidas', () => {
  it('empieza 0-0 y suma partidas sin mutar el marcador anterior', () => {
    const s0 = FIRST_TO_3.start();
    expect(s0).toEqual({ 0: 0, 1: 0 });
    const s1 = FIRST_TO_3.recordPartida(s0, 1);
    expect(s1).toEqual({ 0: 0, 1: 1 });
    expect(s0).toEqual({ 0: 0, 1: 0 });
  });

  it('hay campeón al llegar a 3, no antes', () => {
    let w = FIRST_TO_3.start();
    w = FIRST_TO_3.recordPartida(w, 0);
    w = FIRST_TO_3.recordPartida(w, 1);
    w = FIRST_TO_3.recordPartida(w, 0);
    expect(FIRST_TO_3.champion(w)).toBeNull();
    w = FIRST_TO_3.recordPartida(w, 0);
    expect(FIRST_TO_3.champion(w)).toBe(0);
  });

  it('leader: quién va por delante, null si empate', () => {
    expect(FIRST_TO_3.leader({ 0: 2, 1: 1 })).toBe(0);
    expect(FIRST_TO_3.leader({ 0: 0, 1: 2 })).toBe(1);
    expect(FIRST_TO_3.leader({ 0: 1, 1: 1 })).toBeNull();
  });

  it('otros formatos y validación', () => {
    expect(firstToN(1).champion({ 0: 0, 1: 1 })).toBe(1);
    expect(firstToN(5).id).toBe('first-to-5');
    expect(() => firstToN(0)).toThrow();
  });
});

describe('S2-06 nextHandSetup', () => {
  const base = () => newHand({ id: 't', seed: 's', rules: GUINOTE_ARAGONES, dealer: 2 });

  it('misma partida: vuelta + 1 y arrastra marcadores', () => {
    const prev = { ...base(), vuelta: 1, cumulativeTeamPts: { 0: 70, 1: 60 }, matchEnded: false };
    const { continuation } = nextHandSetup(prev);
    expect(continuation.vuelta).toBe(2);
    expect(continuation.cumulativeTeamPts).toEqual({ 0: 70, 1: 60 });
    expect(continuation.matchEnded).toBe(false);
  });

  it('partida cerrada: vuelta 1 y marcadores a cero', () => {
    const prev = {
      ...base(),
      vuelta: 3,
      cumulativeTeamPts: { 0: 130, 1: 60 },
      score: { buenas: { 0: 30, 1: 0 }, malas: { 0: 0, 1: 60 } },
      matchEnded: true,
      matchWinner: 0 as const,
    };
    const { continuation } = nextHandSetup(prev);
    expect(continuation).toEqual({
      vuelta: 1,
      score: { buenas: { 0: 0, 1: 0 }, malas: { 0: 0, 1: 0 } },
      cumulativeTeamPts: { 0: 0, 1: 0 },
      matchEnded: false,
      matchWinner: null,
    });
  });

  it('dealer: "el que corta, reparte" (misma regla que nextDealer del motor)', () => {
    expect(nextHandSetup(base()).dealer).toBe(nextDealer(null, 2));
  });
});
