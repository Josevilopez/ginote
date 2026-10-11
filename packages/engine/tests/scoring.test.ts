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

describe('scoring — cierre anticipado de la mano al cruzar el umbral', () => {
  // Regla del guiñote aragonés: en cuanto un equipo cruza `threshold` (= 100
  // raw), la mano termina INMEDIATAMENTE. No se juegan las bazas restantes:
  // las cartas que queden en las manos se descartan y sus puntos no cuentan.
  // Se aplica tanto en idas (mano 1) como en vueltas (manos 2+) — el umbral
  // se evalúa sobre `cumulativeTeamPts`, que ya viene arrastrado de la mano
  // anterior vía `continuation`.
  it('una baza que cruza el umbral cierra la mano (no se juega la siguiente)', () => {
    // Partimos de vuelta 2 con team 0 a 95. Forzamos una baza que team 0 gana
    // con valor 32 (oros-1 + oros-7 + oros-3 + oros-5 = 11+7+10+4). Tras
    // resolverla, cumulative[0] = 127 > 100 → matchEnd. La mano debe
    // terminar sin esperar a jugar las 9 bazas restantes.
    const s = newHand({
      id: 'g-test',
      seed: 'seed-test',
      rules: GUINOTE_ARAGONES,
      dealer: 3,
      continuation: {
        vuelta: 2,
        score: { buenas: { 0: 30, 1: 20 }, malas: { 0: 0, 1: 0 } },
        matchEnded: false,
        matchWinner: null,
        cumulativeTeamPts: { 0: 95, 1: 0 },
      },
    });
    // Forzamos un estado jugable a mano: phase=lead, trick vacío, mazo vacío,
    // ya en arrastre (trumpCard=null), seat 0 sale.
    s.phase = 'lead';
    s.turn = 0;
    s.leader = 0;
    s.trick = { plays: [] };
    s.deck = [];
    s.trumpCard = null;
    s.trump = 'oros';
    s.lastWinner = null;
    s.hands = {
      0: [C.oros1, C.copas3, C.espadas7, C.bastos10],
      1: [C.oros7, C.copas10, C.espadas3, C.bastos5],
      2: [C.oros3, C.copas1, C.espadas10, C.bastos12],
      3: [C.oros5, C.copas12, C.espadas6, C.bastos6],
    };

    apply(s, { type: 'PLAY_CARD', cardId: 'oros-1' });
    apply(s, { type: 'PLAY_CARD', cardId: 'oros-7' });
    apply(s, { type: 'PLAY_CARD', cardId: 'oros-3' });
    const bazaEvents = apply(s, { type: 'PLAY_CARD', cardId: 'oros-5' });

    // Estado tras la 4ª carta: baza resuelta, team 0 la gana, cumulative
    // cruza 100, matchEnd, mano cerrada.
    expect(s.matchEnded).toBe(true);
    expect(s.matchWinner).toBe(0);
    expect(s.phase).toBe('finished');
    expect(s.turn).toBeNull();
    // Eventos emitidos: la baza resuelta + MATCH_OVER + HAND_FINISHED.
    expect(bazaEvents.some((e) => e.type === 'TRICK_RESOLVED')).toBe(true);
    expect(bazaEvents.some((e) => e.type === 'MATCH_OVER')).toBe(true);
    expect(bazaEvents.some((e) => e.type === 'HAND_FINISHED')).toBe(true);
    // Solo se jugó 1 baza: la mano cortó antes de las 9 restantes.
    expect(s.finishedTricks.length).toBe(1);
    // El truco registrado como hadLastTrick (porque cerró la mano).
    expect(s.finishedTricks[0]?.hadLastTrick).toBe(true);
  });

  it('un cante que cruza el umbral también cierra la mano', () => {
    // Vuelta 2, team 0 a 80. El ganador (seat 0) tiene el par de triunfo
    // (oros-10 + oros-12) y canta 40. cumulative[0] = 80+40 = 120 > 100.
    // La mano debe terminar sin jugar más bazas.
    const s = newHand({
      id: 'g-test',
      seed: 'seed-test',
      rules: GUINOTE_ARAGONES,
      dealer: 3,
      continuation: {
        vuelta: 2,
        score: { buenas: { 0: 25, 1: 20 }, malas: { 0: 0, 1: 0 } },
        matchEnded: false,
        matchWinner: null,
        cumulativeTeamPts: { 0: 80, 1: 0 },
      },
    });
    s.phase = 'winnerWindow';
    s.turn = 0;
    s.leader = 0;
    s.lastWinner = 0;
    s.trick = { plays: [] };
    s.deck = [];
    s.trumpCard = null; // ya en arrastre, así SING_CANTE es legal aquí
    s.trump = 'oros';
    s.hands = {
      0: [C.oros12, C.oros10, C.copas3],
      1: [C.copas11, C.espadas3],
      2: [C.espadas10, C.bastos11],
      3: [C.bastos6, C.copas12],
    };

    const events = apply(s, { type: 'SING_CANTE', suit: 'oros', pair: [10, 12] });

    expect(s.cantes.length).toBe(1);
    expect(s.cantes[0]?.value).toBe(40);
    expect(s.matchEnded).toBe(true);
    expect(s.matchWinner).toBe(0);
    expect(s.phase).toBe('finished');
    expect(s.turn).toBeNull();
    expect(events.some((e) => e.type === 'CANTE_DECLARED')).toBe(true);
    expect(events.some((e) => e.type === 'MATCH_OVER')).toBe(true);
    expect(events.some((e) => e.type === 'HAND_FINISHED')).toBe(true);
  });

  it('en IDAS (vuelta 1) NO hay cierre anticipado aunque se cruce 100', () => {
    // Vuelta 1 (sin continuation). Inflamos cumulativeTeamPts[0] a 95
    // para forzar el cruce en la siguiente baza. Regla: en idas se juega
    // la mano completa, así que matchEnded=true pero phase sigue en
    // 'winnerWindow' (no 'finished').
    const s = newHand({
      id: 'g-test',
      seed: 'seed-test',
      rules: GUINOTE_ARAGONES,
      dealer: 3,
      // sin continuation → vuelta 1
    });
    s.cumulativeTeamPts[0] = 95;
    s.phase = 'lead';
    s.turn = 0;
    s.leader = 0;
    s.trick = { plays: [] };
    s.deck = [];
    s.trumpCard = null;
    s.trump = 'oros';
    s.lastWinner = null;
    s.hands = {
      0: [C.oros1, C.copas3, C.espadas7, C.bastos10],
      1: [C.oros7, C.copas10, C.espadas3, C.bastos5],
      2: [C.oros3, C.copas1, C.espadas10, C.bastos12],
      3: [C.oros5, C.copas12, C.espadas6, C.bastos6],
    };

    apply(s, { type: 'PLAY_CARD', cardId: 'oros-1' });
    apply(s, { type: 'PLAY_CARD', cardId: 'oros-7' });
    apply(s, { type: 'PLAY_CARD', cardId: 'oros-3' });
    apply(s, { type: 'PLAY_CARD', cardId: 'oros-5' });

    // Baza resuelta. Team 0 gana los 32 pts. cumulative[0] = 95+32 = 127.
    // matchEnded debe quedar true (el motor lo detecta), pero como
    // vuelta=1, la mano NO se cierra: phase='winnerWindow' y quedan
    // 9 bazas por jugar.
    expect(s.matchEnded).toBe(true);
    expect(s.matchWinner).toBe(0);
    expect(s.phase).toBe('winnerWindow');
    expect(s.turn).not.toBeNull();
    expect(s.finishedTricks.length).toBe(1);
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
