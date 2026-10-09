import { describe, it, expect } from 'vitest';
import { teamOf, partnerOf, type Seat } from '../src/index.js';

describe('teams — asientos y compañeros', () => {
  it('partnerOf devuelve el compañero correcto (0↔2, 1↔3)', () => {
    expect(partnerOf(0 as Seat)).toBe(2);
    expect(partnerOf(1 as Seat)).toBe(3);
    expect(partnerOf(2 as Seat)).toBe(0);
    expect(partnerOf(3 as Seat)).toBe(1);
  });

  it('teamOf agrupa compañeros en el mismo equipo (0,2) y (1,3)', () => {
    expect(teamOf(0 as Seat)).toBe(0);
    expect(teamOf(2 as Seat)).toBe(0);
    expect(teamOf(1 as Seat)).toBe(1);
    expect(teamOf(3 as Seat)).toBe(1);
  });

  it('compañeros son del mismo equipo', () => {
    const seats: Seat[] = [0, 1, 2, 3];
    for (const s of seats) {
      expect(teamOf(s)).toBe(teamOf(partnerOf(s)));
    }
  });

  it('seat 1 NO está en el mismo equipo que seat 0', () => {
    expect(teamOf(0 as Seat)).not.toBe(teamOf(1 as Seat));
  });
});
