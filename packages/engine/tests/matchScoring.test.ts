import { describe, expect, it } from 'vitest';
import {
  COTO_MATCH_FORMAT,
  FIRST_TO_3,
  firstToN,
  GUINOTE_ARAGONES,
  isValidFormat,
  newHand,
  nextDealer,
  nextHandSetup,
  progressLeader,
  QUICK_FORMAT,
  recordPartidaResult,
  startProgress,
} from '../src/index.js';

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


describe('S3-07 formato coto / match', () => {
  it('partida rápida (1 coto a 3): el coto decide la mesa', () => {
    let p = startProgress();
    for (const w of [0, 1, 0] as const) {
      const r = recordPartidaResult(p, w, QUICK_FORMAT);
      expect(r.cotoWinner).toBeNull();
      p = r.progress;
    }
    const r = recordPartidaResult(p, 0, QUICK_FORMAT);
    expect(r).toMatchObject({ cotoWinner: 0, matchWinner: 0 });
    expect(r.progress.partidas).toEqual({ 0: 3, 1: 1 });
    expect(r.progress.cotos).toEqual({ 0: 1, 1: 0 });
  });

  it('match a 2 cotos: ganar un coto reinicia las partidas y no acaba la mesa', () => {
    let p = startProgress();
    for (let i = 0; i < 2; i++) p = recordPartidaResult(p, 1, COTO_MATCH_FORMAT).progress;
    const r = recordPartidaResult(p, 1, COTO_MATCH_FORMAT);
    expect(r).toMatchObject({ cotoWinner: 1, matchWinner: null });
    expect(r.progress).toEqual({ partidas: { 0: 0, 1: 0 }, cotos: { 0: 0, 1: 1 } });
  });

  it('match a 2 cotos: el segundo coto gana el match (1-1 en cotos y desempate)', () => {
    let p = { partidas: { 0: 2, 1: 2 }, cotos: { 0: 1, 1: 1 } };
    const r = recordPartidaResult(p, 0, COTO_MATCH_FORMAT);
    expect(r).toMatchObject({ cotoWinner: 0, matchWinner: 0 });
    expect(r.progress).toEqual({ partidas: { 0: 3, 1: 2 }, cotos: { 0: 2, 1: 1 } });
    p = r.progress;
  });

  it('líder: cotos primero, partidas para desempatar', () => {
    expect(progressLeader({ partidas: { 0: 0, 1: 2 }, cotos: { 0: 1, 1: 0 } })).toBe(0);
    expect(progressLeader({ partidas: { 0: 0, 1: 2 }, cotos: { 0: 1, 1: 1 } })).toBe(1);
    expect(progressLeader(startProgress())).toBeNull();
  });

  it('validación de formatos', () => {
    expect(isValidFormat({ partidasPorCoto: 3, cotosParaGanar: 2 })).toBe(true);
    expect(isValidFormat({ partidasPorCoto: 0, cotosParaGanar: 2 })).toBe(false);
    expect(isValidFormat({ partidasPorCoto: 3, cotosParaGanar: 9 })).toBe(false);
    expect(isValidFormat({ partidasPorCoto: 2.5, cotosParaGanar: 1 })).toBe(false);
  });
});
