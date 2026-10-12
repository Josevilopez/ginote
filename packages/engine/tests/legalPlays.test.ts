import { describe, it, expect } from 'vitest';
import { legalPlays, type GameState } from '../src/index.js';
import { C, makeState } from './builders.js';

function ids(cards: readonly { id: string }[]): string[] {
  return cards.map((c) => c.id);
}

describe('legalPlays — fase de robo', () => {
  it('permite cualquier carta cuando trumpCard está visible', () => {
    const s = makeState({
      phase: 'lead',
      trump: 'oros',
      hands: { 0: [C.oros1, C.copas3, C.espadas7, C.bastos12, C.oros6, C.copas11], 1: [], 2: [], 3: [] },
    });
    expect(ids(legalPlays(s, 0))).toEqual([
      'oros-1', 'copas-3', 'espadas-7', 'bastos-12', 'oros-6', 'copas-11',
    ]);
  });
});

describe('legalPlays — salida (trick vacío)', () => {
  it('permite cualquier carta en arrastre', () => {
    const s = makeState({
      phase: 'lead',
      trump: 'oros',
      trumpCard: null,
      hands: { 0: [C.copas3, C.espadas7, C.bastos12, C.oros6, C.copas11, C.espadas1], 1: [], 2: [], 3: [] },
    });
    expect(legalPlays(s, 0).length).toBe(6);
  });
});

describe('legalPlays — seguir palo', () => {
  it('obliga a jugar el palo de salida si lo tienes, y a superar si puedes', () => {
    // Sale seat 1 con copas-3. Turno de seat 2 con copas-1 (As) y copas-11 (Caballo).
    // partnerWins = false (el ganador es seat 1 que no es compañero de seat 2).
    // mustOverplay = true → copas-1 supera copas-3, copas-11 NO. Solo copas-1.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.copas3 }],
      hands: {
        0: [],
        1: [],
        2: [C.copas1, C.espadas7, C.bastos12, C.oros6, C.copas11, C.espadas1],
        3: [],
      },
    });
    expect(ids(legalPlays(s, 2))).toEqual(['copas-1']);
  });
});

describe('legalPlays — superar', () => {
  it('obliga a superar la carta que va ganando', () => {
    // Sale seat 1 con copas-3. Turno de seat 2 con copas-1 y copas-11 en mano.
    // Como copas-1 gana a copas-3, el jugador está obligado a tirar copas-1.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.copas3 }],
      hands: {
        0: [],
        1: [],
        2: [C.copas1, C.copas11, C.espadas7, C.bastos12, C.oros6, C.espadas1],
        3: [],
      },
    });
    expect(ids(legalPlays(s, 2))).toEqual(['copas-1']);
  });

  it('si no puedes superar, juegas cualquiera del palo', () => {
    // Sale seat 1 con copas-1. Turno de seat 2 con copas-3 y copas-11.
    // No puede superar (copas-3 y copas-11 < copas-1 en fuerza). Juega cualquiera.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.copas1 }],
      hands: {
        0: [],
        1: [],
        2: [C.copas3, C.copas11, C.espadas7, C.bastos12, C.oros6, C.espadas1],
        3: [],
      },
    });
    expect(ids(legalPlays(s, 2))).toEqual(['copas-3', 'copas-11']);
  });
});

describe('legalPlays — exención por compañero', () => {
  it('compañero ganando exime de superar', () => {
    // Sale seat 0 con copas-1. Turno de seat 1 (compañero de 0). Seat 2 ya ganó
    // con copas-3. Seat 1 tiene copas-11 y copas-3. Como compañero (seat 0)
    // NO va ganando, debe superar copas-3 con copas-1... no tiene. Juega
    // cualquiera del palo. Probamos la exención con otro caso:
    // Sale 0 con copas-3. Seat 1 juega copas-1. Turno de seat 2. Seat 2
    // tiene copas-11. Compañero (seat 0) NO va ganando, debe superar copas-1.
    // No puede, juega cualquiera.
    // Para exención: necesitamos que el compañero gane.
    // Sale 0 con copas-3. Seat 1 juega copas-1. Gana seat 1. Turno de seat 2.
    // Seat 2 tiene copas-11 (no supera copas-1) y copas-7.
    // Como compañero (seat 0) NO va ganando, debe jugar palo (no superar).
    // Exención: si compañero (seat 0) fuera ganando, podría jugar lo que quisiera.
    // Vamos a probar: sale 0 con copas-11. Seat 1 juega copas-1. Gana seat 1.
    // Turno de seat 2. Seat 2 tiene copas-3 (sí supera copas-1).
    // Como compañero (seat 0) NO va ganando, debe superar: juega copas-3.
    // Ahora cambiamos: sale 0 con copas-1. Gana seat 0. Turno de seat 2.
    // Seat 2 tiene copas-3 y copas-7. Compañero (seat 0) gana, exime de superar.
    // Juega cualquiera del palo.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 0,
      turn: 2,
      trick: [
        { seat: 0, card: C.copas1 },
        { seat: 1, card: C.copas11 },
      ],
      hands: {
        0: [],
        1: [],
        2: [C.copas3, C.copas7, C.espadas7, C.bastos12, C.oros6, C.espadas1],
        3: [],
      },
    });
    // Winner actual: seat 0 (copas-1 gana a copas-11). Compañero de seat 2 es seat 0.
    // partnerWins = true → exime de superar. Juega cualquiera del palo copas.
    expect(ids(legalPlays(s, 2))).toEqual(['copas-3', 'copas-7']);
  });
});

describe('legalPlays — fallar con triunfo', () => {
  it('si no tienes el palo y tienes varios triunfos, debes jugar el que supera al de mesa', () => {
    // Sale seat 1 con copas-3. Turno de seat 2, no tiene copas, tiene oros-1 (As) y oros-3.
    // Como hay triunfo en mesa, ambos ganan a copas-3; debe jugar el más fuerte (oros-1).
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.copas3 }],
      hands: {
        0: [],
        1: [],
        2: [C.oros1, C.oros3, C.espadas7, C.bastos12, C.espadas1, C.bastos6],
        3: [],
      },
    });
    expect(ids(legalPlays(s, 2))).toEqual(['oros-1', 'oros-3']);
  });

  it('si no puedes superar con triunfo y mustTrumpEvenIfCantBeat=false, NO estás obligado a tirar el triunfo flojo', () => {
    // Regla confirmada en `docs/guinote-aragones-diseno.md` línea 38:
    // "Sin el palo de salida, con triunfo en mesa más alto que el tuyo y
    // sin poder superarlo: no obligado a tirar triunfo". El jugador
    // puede descartar libremente (toda la mano es legal).
    //
    // Setup: sale seat 1 con copas-3 (palo no triunfo). Seat 2 (otro
    // rival) juega oros-3 (el "3" de triunfo, gana). Turno de seat 3:
    // no tiene copas, tiene oros-7 (triunfo flojo que NO gana a
    // oros-3) y descartes. Como mustTrumpEvenIfCantBeat = false → puede
    // jugar cualquier carta (incluido descartar otra cosa en vez del
    // triunfo flojo).
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 3,
      trick: [
        { seat: 1, card: C.copas3 },
        { seat: 2, card: C.oros3 },
      ],
      hands: {
        0: [],
        1: [],
        2: [],
        3: [C.espadas7, C.bastos12, C.espadas1, C.bastos10, C.oros7, C.oros6],
      },
    });
    // Winner: seat 2 con oros-3. Seat 3 es rival del ganador, no tiene
    // copas (palo de salida), tiene oros-7 (flojo, no gana a oros-3) y
    // descartes. Con mustTrumpEvenIfCantBeat = false, las 6 cartas son
    // legales (puede descartar).
    expect(legalPlays(s, 3).length).toBe(6);
  });

  it('si ALGÚN triunfo sí gana al de mesa, ese sí es obligatorio (independiente de mustTrumpEvenIfCantBeat)', () => {
    // Complemento: aunque `mustTrumpEvenIfCantBeat` sea false (puedo
    // descartar si NINGUNO de mis triunfos gana), si tengo AL MENOS un
    // triunfo que SÍ gana al de mesa, estoy obligado a jugar uno
    // superior (rama `if (higher.length > 0) return higher`). Sale
    // seat 1 con oros-3 (el "3"). Turno de seat 2 con oros-1 (el As,
    // gana a oros-3) y oros-5 (flojo). Solo oros-1 es legal.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.oros3 }],
      hands: {
        0: [],
        1: [],
        2: [C.copas3, C.espadas7, C.bastos12, C.oros1, C.oros5, C.espadas1],
        3: [],
      },
    });
    // Winner: seat 1 con oros-3. Seat 2 tiene oros-1 (gana) y oros-5
    // (no gana). Solo oros-1 es legal.
    expect(ids(legalPlays(s, 2))).toEqual(['oros-1']);
  });

  it('si no tienes ni palo ni triunfo, juegas cualquier carta', () => {
    // Trump oros. Sale seat 1 con copas-3. Turno de seat 2 sin copas ni oros.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.copas3 }],
      hands: {
        0: [],
        1: [],
        2: [C.espadas7, C.bastos12, C.espadas1, C.bastos7, C.espadas6, C.bastos5],
        3: [],
      },
    });
    expect(legalPlays(s, 2).length).toBe(6);
  });

  it('compañero ganando exime de fallar con triunfo: puedes descartar (partnerWinningExemptsTrump=true)', () => {
    // Trump: oros. Sale seat 0 con copas-3. Seat 1 (no compañero de 2) juega bastos-7
    // (no tiene copas; no es triunfo). Copas-3 va ganando. Turno de seat 2.
    // Seat 2 es compañero de seat 0 → partnerWins = true. Seat 2 no tiene copas,
    // tiene oros-1 (triunfo) y bastos-10/espadas (descartes).
    // Con partnerWinningExemptsTrump=true, puede descartar en vez de tirar el triunfo.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 0,
      turn: 2,
      trick: [
        { seat: 0, card: C.copas3 },
        { seat: 1, card: C.bastos7 },
      ],
      hands: {
        0: [],
        1: [],
        2: [C.oros1, C.bastos10, C.espadas7, C.bastos12, C.espadas1, C.oros7],
        3: [],
      },
    });
    // Winner actual: seat 0 (copas-3 única copas en mesa). partner de seat 2 = seat 0.
    // partnerWins=true → exención total → las 6 cartas son legales.
    expect(legalPlays(s, 2).length).toBe(6);
  });

  it('rival gana con triunfo superior, ninguno de mis triunfos lo supera → descarte libre (mustTrumpEvenIfCantBeat=false)', () => {
    // Trump: oros. Sale seat 0 con copas-3. Seat 1 juega oros-1 (triunfo, gana).
    // Turno de seat 2 (rival del ganador). Seat 2 NO tiene copas, tiene oros-7
    // y oros-6 (triunfos flojos que NO superan oros-1) y descartes.
    //
    // Como `mustTrumpEvenIfCantBeat = false`, el jugador NO está obligado
    // a tirar un triunfo flojo: puede descartar cualquier carta de su
    // mano. Las 6 cartas son legales.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 0,
      turn: 2,
      trick: [
        { seat: 0, card: C.copas3 },
        { seat: 1, card: C.oros1 },
      ],
      hands: {
        0: [],
        1: [],
        2: [C.oros7, C.espadas7, C.bastos12, C.espadas1, C.bastos10, C.oros6],
        3: [],
      },
    });
    // Winner: seat 1 (oros-1). partner de seat 2 = seat 0, NO gana → debe
    // intentar fallar con triunfo. oros-7/6 no superan oros-1 →
    // mustTrumpEvenIfCantBeat=false → descarte libre, las 6 cartas son
    // legales.
    expect(legalPlays(s, 2).length).toBe(6);
  });
});
