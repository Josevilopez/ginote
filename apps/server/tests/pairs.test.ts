import { beforeEach, describe, expect, it } from 'vitest';
import { ABANDONS_FOR_BAN, BAN_MS, activeBan, recordAbandon } from '../src/abandons.js';
import { MemoryPairRepo, _clearPairCache, pairId, topPairEntries, updatePairs, type PairMember } from '../src/pairs.js';

/** S4-07 (abandonos) y S4-05 (parejas). */
describe('abandonos repetidos', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it(`${ABANDONS_FOR_BAN} en 24 h → ${BAN_MS / 60000} min sin cola; los viejos no cuentan`, () => {
    const old = '2026-10-19T08:00:00Z'; // hace 28 h
    expect(recordAbandon([old], now)).toEqual({ abandons: [now.toISOString()], banUntil: null });
    const two = ['2026-10-20T09:00:00Z', '2026-10-20T11:00:00Z'];
    const r = recordAbandon(two, now);
    expect(r.abandons).toHaveLength(3);
    expect(r.banUntil).toBe('2026-10-20T12:05:00.000Z');
    expect(activeBan(r.banUntil, now.getTime())).toBe(Date.parse('2026-10-20T12:05:00Z'));
    expect(activeBan(r.banUntil, now.getTime() + BAN_MS)).toBeNull();
    expect(activeBan(undefined)).toBeNull();
  });
});

const m = (id: string, province: string | null = null, municipio: string | null = null): PairMember => ({
  playerId: id,
  name: id.toUpperCase(),
  tag: '0001',
  province,
  municipio,
});

describe('parejas', () => {
  let repo: MemoryPairRepo;
  beforeEach(() => {
    repo = new MemoryPairRepo();
    _clearPairCache();
  });

  it('pareja contra dos sueltos: solo se mueve la pareja; se crea a 1000', async () => {
    const out = await updatePairs(repo, { 0: { pair: [m('jose', '44', '44013'), m('pilar', '44', '44013')], meanRating: 1000 }, 1: { pair: null, meanRating: 1000 } }, 0);
    expect(out).toHaveLength(1);
    const p = (await repo.get(pairId('pilar', 'jose')))!;
    expect(p).toMatchObject({ games: 1, wins: 1, losses: 0, place: { province: '44', municipio: '44013' } });
    expect(p.rating).toBeGreaterThan(1000);
    expect(p.players).toEqual(['jose', 'pilar']);
  });

  it('pareja contra pareja: se usan los niveles de pareja', async () => {
    await repo.put({ ...(await updatePairs(repo, { 0: { pair: [m('a'), m('b')], meanRating: 1000 }, 1: { pair: null, meanRating: 1000 } }, 0))[0]!, rating: 1300 });
    const out = await updatePairs(repo, { 0: { pair: [m('a'), m('b')], meanRating: 900 }, 1: { pair: [m('c'), m('d')], meanRating: 1500 } }, 1);
    const ab = out.find((p) => p.id === pairId('a', 'b'))!;
    const cd = out.find((p) => p.id === pairId('c', 'd'))!;
    // La pareja fuerte (1300) pierde contra la nueva (1000): baja más de lo normal.
    expect(1300 - ab.rating).toBeGreaterThan(20);
    expect(cd.rating).toBeGreaterThan(1020);
  });

  it('el sitio de la pareja solo cuenta si los dos son del mismo', async () => {
    await updatePairs(repo, { 0: { pair: [m('a', '44', '44013'), m('b', '44', '44216')], meanRating: 1000 }, 1: { pair: null, meanRating: 1000 } }, 0);
    expect((await repo.get(pairId('a', 'b')))!.place).toEqual({ province: '44', municipio: null });
  });

  it('ranking: ≥ 5 partidas y por ámbito; marca tus parejas', async () => {
    const since = '2026-01-01T00:00:00Z';
    const base = { wins: 0, losses: 0, lastPlayedAt: '2026-10-20T10:00:00Z' };
    await repo.put({ id: 'a|b', players: ['a', 'b'], members: [m('a'), m('b')], rating: 1200, games: 8, place: { province: '44', municipio: null }, ...base });
    await repo.put({ id: 'c|d', players: ['c', 'd'], members: [m('c'), m('d')], rating: 1300, games: 5, place: { province: '50', municipio: null }, ...base });
    await repo.put({ id: 'a|e', players: ['a', 'e'], members: [m('a'), m('e')], rating: 1400, games: 3, place: { province: null, municipio: null }, ...base });
    const es = await topPairEntries(repo, { kind: 'es' }, since, 'a');
    expect(es.map((e) => [e.pos, e.name, e.points, e.you])).toEqual([
      [1, 'C & D', 1300, false],
      [2, 'A & B', 1200, true],
    ]);
    _clearPairCache();
    expect((await topPairEntries(repo, { kind: 'prov', province: '44' }, since, null)).map((e) => e.name)).toEqual(['A & B']);
    expect(await repo.countAbove({ kind: 'es' }, since, 1200)).toBe(1);
    expect((await repo.forPlayer('a')).map((p) => p.id).sort()).toEqual(['a|b', 'a|e']);
    await repo.removePlayer('a');
    expect([...repo.map.keys()]).toEqual(['c|d']);
  });
});
