import { describe, expect, it } from 'vitest';
import { rolloverSeason, seasonEndLabel, seasonId, seasonName } from '@guinote/protocol';

/** S4-09 — temporadas trimestrales, insignia y reinicio a medio camino de 1000. */
describe('temporadas', () => {
  it('trimestres en hora de España', () => {
    expect(seasonId(new Date('2026-10-20T12:00:00Z'))).toBe('2026-T4');
    // 30 sep a las 23:30 en Madrid sigue siendo verano…
    expect(seasonId(new Date('2026-09-30T21:30:00Z'))).toBe('2026-T3');
    // …y el 1 de octubre a las 00:30 en Madrid ya es otoño (30 sep 22:30Z).
    expect(seasonId(new Date('2026-09-30T22:30:00Z'))).toBe('2026-T4');
    expect(seasonId(new Date('2027-01-01T00:30:00+01:00'))).toBe('2027-T1');
    expect(seasonName('2026-T4')).toBe('Otoño 2026');
    expect(seasonName('2027-T1')).toBe('Invierno 2027');
    expect(seasonEndLabel('2026-T4')).toBe('31 de diciembre');
  });

  const now = new Date('2027-01-10T12:00:00Z'); // Invierno 2027

  it('ya en la temporada actual: nada que hacer', () => {
    expect(rolloverSeason({ rating: 1200, games: 30, seasonId: '2027-T1' }, now)).toBeNull();
  });

  it('jugadores de antes (sin temporada): se apunta la actual sin reiniciar', () => {
    expect(rolloverSeason({ rating: 1234, games: 30 }, now)).toEqual({ rating: 1234, seasonId: '2027-T1', seasonPeak: 1234, seasonBadges: [] });
  });

  it('de una temporada anterior: insignia por su mejor nivel y nivel a medio camino de 1000', () => {
    expect(rolloverSeason({ rating: 1300, games: 30, seasonId: '2026-T4', seasonPeak: 1380 }, now)).toEqual({
      rating: 1150,
      seasonId: '2027-T1',
      seasonPeak: 1150,
      seasonBadges: [{ season: '2026-T4', division: 'leyenda' }],
    });
    expect(rolloverSeason({ rating: 800, games: 30, seasonId: '2026-T4' }, now)!.rating).toBe(900);
  });

  it('sin clasificar no hay insignia; no se repite', () => {
    expect(rolloverSeason({ rating: 1100, games: 4, seasonId: '2026-T4' }, now)!.seasonBadges).toEqual([]);
    const again = rolloverSeason({ rating: 1100, games: 40, seasonId: '2026-T4', seasonBadges: [{ season: '2026-T4', division: 'oro' }] }, now)!;
    expect(again.seasonBadges).toHaveLength(1);
  });
});
