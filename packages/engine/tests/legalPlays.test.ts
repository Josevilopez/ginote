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

  it('si no puedes superar con triunfo y mustTrumpEvenIfCantBeat, juegas cualquier triunfo', () => {
    // Sale seat 1 con copas-1. Turno de seat 2, no tiene copas, tiene oros-3 (no supera).
    // oros-3 no supera copas-1 (distinto palo, oros-3 no es triunfo suficiente vs copas-1).
    // Espera, copas-1 no es triunfo (trump=oros). oros-3 sí es triunfo, y cualquier
    // triunfo gana a no-triunfo. Así que oros-3 SÍ supera copas-1.
    // Vamos a poner oros-7: oros-7 es triunfo pero no supera a otro oros-7 (no hay).
    // Hmm, super es "triunfo > no-triunfo". Un oros-7 gana a copas-1 porque es triunfo.
    // Para "no supera con triunfo": necesitamos que el triunfo de mesa sea más alto.
    // Oros-1 (As de oros) en mesa. oros-3 no lo supera. Pero si el jugador no tiene
    // oros-1, oros-3, oros-12, etc., y solo tiene oros-7,6,5,4,2, tampoco puede superar.
    const s = makeState({
      phase: 'follow',
      trump: 'oros',
      trumpCard: null,
      leader: 1,
      turn: 2,
      trick: [{ seat: 1, card: C.oros1 }],
      hands: {
        0: [],
        1: [],
        2: [C.copas3, C.espadas7, C.bastos12, C.oros6, C.oros5, C.espadas1],
        3: [],
      },
    });
    // Winner: seat 1 con oros-1. El jugador 2 no tiene copas, tiene oros-6 y oros-5.
    // Ninguno supera oros-1. Como mustTrumpEvenIfCantBeat = true, juega cualquier oros.
    expect(ids(legalPlays(s, 2))).toEqual(['oros-6', 'oros-5']);
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

  it('compañero ganando exime también de superar el triunfo (puede tirar triunfo flojo)', () => {
    // Trump: oros. Sale seat 0 con copas-3. Seat 1 juega oros-1 (triunfo, gana).
    // Turno de seat 2 (compañero de seat 0). Seat 2 NO tiene copas, tiene oros-7
    // (triunfo flojo) y descartes.
    // partner (seat 0) NO va ganando (seat 1 trumpó), así que debe fallar con triunfo.
    // oros-7 no supera oros-1 → como mustTrumpEvenIfCantBeat=true, juega oros-7.
    // (Verifica que el flag mustTrumpEvenIfCantBeat sigue forzando un triunfo
    // flojo cuando el oponente gana, no el compañero.)
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
    // Winner: seat 1 (oros-1). partner (seat 0) NO gana → debe triunfar. oros-7/6
    // no superan oros-1 → mustTrumpEvenIfCantBeat=true → juega cualquier oros
    // (no descartes de otros palos).
    expect(ids(legalPlays(s, 2)).sort()).toEqual(['oros-6', 'oros-7']);
  });
});
