import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshPlayer, type LinkedPlayer } from '../src/auth/accounts.js';
import {
  MemoryRankingSource,
  _clearRankingCache,
  activeSince,
  cleanPublicName,
  eligibility,
  topEntries,
  weekEligibility,
} from '../src/ranking.js';
import { seasonId, weekId } from '@guinote/protocol';

/** S4-04 — ranking individual: con cuenta, ≥ 10 partidas, activo en 30 días. */
const now = new Date('2026-10-20T12:00:00Z');
const recent = '2026-10-19T12:00:00Z';
const old = '2026-08-01T12:00:00Z';

function p(id: string, rating: number, extra: { [K in keyof LinkedPlayer]?: LinkedPlayer[K] | undefined } = {}): LinkedPlayer {
  return {
    ...freshPlayer(id),
    rating,
    games: 20,
    userId: `g_${id}`,
    lastPlayedAt: recent,
    publicName: id.toUpperCase(),
    tag: '1234',
    seasonId: seasonId(),
    ...extra,
  } as LinkedPlayer;
}

describe('quién sale', () => {
  it('motivos para no salir', () => {
    expect(eligibility(null, now)).toEqual({ ok: false, reason: 'no_account' });
    expect(eligibility(p('a', 1000, { userId: undefined }), now)).toEqual({ ok: false, reason: 'no_account' });
    expect(eligibility(p('a', 1000, { mergedInto: 'b' }), now)).toEqual({ ok: false, reason: 'no_account' });
    expect(eligibility(p('a', 1000, { games: 7 }), now)).toEqual({ ok: false, reason: 'placement', gamesLeft: 3 });
    expect(eligibility(p('a', 1000, { lastPlayedAt: old }), now)).toEqual({ ok: false, reason: 'inactive' });
    expect(eligibility(p('a', 1000, { seasonId: seasonId(now) }), now)).toEqual({ ok: true });
    // S4-09: no ha jugado en la temporada actual.
    expect(eligibility(p('a', 1000, { seasonId: '2020-T1' }), now)).toEqual({ ok: false, reason: 'inactive' });
  });
  it('nombre público', () => {
    expect(cleanPublicName('  Jose   Vicente ')).toBe('Jose Vicente');
    expect(cleanPublicName('x'.repeat(30))).toHaveLength(20);
    expect(cleanPublicName('   ')).toBeNull();
    expect(cleanPublicName(5)).toBeNull();
  });
});

describe('ranking', () => {
  beforeEach(() => _clearRankingCache());
  const teruel = { province: '44', municipio: '44013' };
  const zgz = { province: '50', municipio: '50297' };
  const players = [
    p('ana', 1300, { place: teruel }),
    p('bea', 1100, { place: zgz }),
    p('cris', 1200, { place: { province: '44', municipio: '44216' } }),
    p('dani', 1500, { lastPlayedAt: old }), // inactivo
    p('eva', 1400, { games: 5 }), // sin clasificar
    p('fer', 1450, { userId: undefined }), // invitado
    p('gus', 1000, { place: teruel }),
  ];
  const source = new MemoryRankingSource(() => players);

  it('España: ordenado por puntos, solo los que cuentan', async () => {
    const e = await topEntries(source, { kind: 'es' }, 'cris', now);
    expect(e.map((x) => [x.pos, x.name, x.rating, x.division, x.you])).toEqual([
      [1, 'ANA', 1300, 'maestro', false],
      [2, 'CRIS', 1200, 'maestro', true],
      [3, 'BEA', 1100, 'oro', false],
      [4, 'GUS', 1000, 'plata', false],
    ]);
  });

  it('por provincia y por pueblo', async () => {
    expect((await topEntries(source, { kind: 'prov', province: '44' }, null, now)).map((x) => x.name)).toEqual(['ANA', 'CRIS', 'GUS']);
    expect((await topEntries(source, { kind: 'mun', municipio: '44013' }, null, now)).map((x) => x.name)).toEqual(['ANA', 'GUS']);
  });

  it('tu puesto aunque no estés en el top', async () => {
    expect(await source.countAbove({ kind: 'es' }, activeSince(now), 1000)).toBe(3);
  });

  it('caché de 1 minuto', async () => {
    const spy = vi.spyOn(source, 'top');
    await topEntries(source, { kind: 'es' }, null, now);
    await topEntries(source, { kind: 'es' }, null, new Date(now.getTime() + 30_000));
    expect(spy).toHaveBeenCalledTimes(1);
    await topEntries(source, { kind: 'es' }, null, new Date(now.getTime() + 61_000));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('S4-06 semanal', () => {
  beforeEach(() => _clearRankingCache());
  const week = weekId();
  const players = [
    p('ana', 1300, { weekId: week, weekPoints: 12, weekGames: 5 }),
    p('novato', 1000, { games: 4, weekId: week, weekPoints: 45, weekGames: 4 }), // nuevo: sí sale en el semanal
    p('bea', 1100, { weekId: week, weekPoints: -20, weekGames: 3 }),
    p('cris', 1200, { weekId: week, weekPoints: 80, weekGames: 2 }), // solo 2 partidas
    p('dani', 1500, { weekId: '2020-W01', weekPoints: 300, weekGames: 30 }), // otra semana
    p('fer', 1450, { userId: undefined, weekId: week, weekPoints: 99, weekGames: 9 }), // invitado
  ];
  const source = new MemoryRankingSource(() => players);

  it('por puntos ganados esta semana; un recién llegado puede ir primero', async () => {
    const e = await topEntries(source, { kind: 'es' }, 'bea', new Date(), 'week');
    expect(e.map((x) => [x.pos, x.name, x.points, x.you])).toEqual([
      [1, 'NOVATO', 45, false],
      [2, 'ANA', 12, false],
      [3, 'BEA', -20, true],
    ]);
    expect(e[0]!.division).toBeNull(); // aún sin clasificar en el general
    expect(await source.countAboveWeek({ kind: 'es' }, week, 12)).toBe(1);
  });

  it('para salir: cuenta y 3 partidas esta semana', () => {
    expect(weekEligibility(players[0]!, week)).toEqual({ ok: true });
    expect(weekEligibility(players[3]!, week)).toEqual({ ok: false, reason: 'week_games', gamesLeft: 1 });
    expect(weekEligibility(players[4]!, week)).toEqual({ ok: false, reason: 'week_games', gamesLeft: 3 });
    expect(weekEligibility(players[5]!, week)).toEqual({ ok: false, reason: 'no_account' });
  });
});
