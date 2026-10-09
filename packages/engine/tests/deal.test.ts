import { describe, it, expect } from 'vitest';
import { newHand, GUINOTE_ARAGONES, SEATS } from '../src/index.js';
import { nextSeat } from '../src/index.js';

describe('Reparto', () => {
  it('reparte 6 cartas a cada jugador', () => {
    const s = newHand({ id: 'g1', seed: 'seed-a', rules: GUINOTE_ARAGONES, dealer: 0 });
    for (const seat of SEATS) {
      expect(s.hands[seat]!.length).toBe(6);
    }
  });

  it('deja 16 cartas en el mazo + 1 triunfo visible (sin la trumpCard en el mazo)', () => {
    const s = newHand({ id: 'g1', seed: 'seed-a', rules: GUINOTE_ARAGONES, dealer: 0 });
    expect(s.deck.length).toBe(40 - 24 - 1);
    expect(s.trumpCard).not.toBeNull();
    expect(s.trump).toBe(s.trumpCard!.suit);
  });

  it('marca la salida como dealer+1', () => {
    for (const dealer of SEATS) {
      const s = newHand({ id: 'g1', seed: 'seed-a', rules: GUINOTE_ARAGONES, dealer });
      expect(s.leader).toBe(nextSeat(dealer));
      expect(s.turn).toBe(s.leader);
    }
  });

  it('comienza en phase=lead', () => {
    const s = newHand({ id: 'g1', seed: 'seed-a', rules: GUINOTE_ARAGONES, dealer: 0 });
    expect(s.phase).toBe('lead');
  });

  it('es determinista: misma seed produce mismo estado', () => {
    const a = newHand({ id: 'g1', seed: 'fixed', rules: GUINOTE_ARAGONES, dealer: 0 });
    const b = newHand({ id: 'g1', seed: 'fixed', rules: GUINOTE_ARAGONES, dealer: 0 });
    expect(a.trump).toBe(b.trump);
    for (const seat of SEATS) {
      expect(a.hands[seat]!.map((c) => c.id)).toEqual(b.hands[seat]!.map((c) => c.id));
    }
  });

  it('distintas seeds producen estados diferentes', () => {
    const a = newHand({ id: 'g1', seed: 'seed-x', rules: GUINOTE_ARAGONES, dealer: 0 });
    const b = newHand({ id: 'g1', seed: 'seed-y', rules: GUINOTE_ARAGONES, dealer: 0 });
    const same = a.trump === b.trump && SEATS.every((s) =>
      a.hands[s]!.map((c) => c.id).join() === b.hands[s]!.map((c) => c.id).join(),
    );
    expect(same).toBe(false);
  });
});
