import { describe, expect, it } from 'vitest';
import { PLACEMENT_GAMES, divisionFor, divisionName, divisionOfRating, nextDivision } from '@guinote/protocol';

/** S4-02 — cortes confirmados: Bronce < 900 · Plata · Oro 1050 · Maestro 1200 · Leyenda 1350. */
describe('divisiones', () => {
  it('cortes', () => {
    expect(divisionOfRating(899)).toBe('bronce');
    expect(divisionOfRating(900)).toBe('plata');
    expect(divisionOfRating(1000)).toBe('plata');
    expect(divisionOfRating(1050)).toBe('oro');
    expect(divisionOfRating(1199)).toBe('oro');
    expect(divisionOfRating(1200)).toBe('maestro');
    expect(divisionOfRating(1350)).toBe('leyenda');
    expect(divisionOfRating(2000)).toBe('leyenda');
    expect(divisionName('maestro')).toBe('Maestro');
  });
  it(`sin clasificar hasta ${PLACEMENT_GAMES} partidas`, () => {
    expect(divisionFor(1300, PLACEMENT_GAMES - 1)).toBeNull();
    expect(divisionFor(1300, PLACEMENT_GAMES)).toBe('maestro');
  });
  it('lo que falta para la siguiente', () => {
    expect(nextDivision(1000)).toEqual({ division: 'oro', missing: 50 });
    expect(nextDivision(1049.4)).toEqual({ division: 'oro', missing: 1 });
    expect(nextDivision(1400)).toBeNull();
  });
});
