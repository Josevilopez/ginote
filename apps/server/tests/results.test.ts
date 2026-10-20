import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S4-01 — Historial de partidas y rachas. Cosmos `players` se simula con
 * un Map; el historial va a un repo en memoria.
 */
type Doc = { id: string; rating: number; games: number; wins: number; losses: number; streak?: number; bestStreak?: number; userId?: string; weekId?: string; weekPoints?: number; weekGames?: number; lastPlayedAt?: string; abandons?: string[]; queueBanUntil?: string; publicName?: string; seasonId?: string; seasonPeak?: number; seasonBadges?: { season: string; division: string }[] };
const docs = new Map<string, Doc>();
const fakeCosmos = {
  players: {
    item: (id: string) => ({ read: async () => ({ resource: docs.get(id) }) }),
    items: { upsert: async (d: Doc) => { docs.set(d.id, d); return {}; } },
  },
};
vi.mock('../src/globalHandles.js', () => ({ getCosmosHandles: () => fakeCosmos, setCosmosHandles: () => undefined }));

const { createRoom, substituteWithBot, updateEloOnHandEnd } = await import('../src/room.js');
const { MemoryResultRepo, setResultRepo, nextStreak, describeTable, recentFor, recordResult } = await import('../src/results.js');
const { weekId, seasonId } = await import('@guinote/protocol');
const { MemoryPairRepo, setPairRepo, pairId } = await import('../src/pairs.js');
const pairs = new MemoryPairRepo();

const repo = new MemoryResultRepo();
const player = (id: string, extra: Partial<Doc> = {}) => docs.set(id, { id, rating: 1000, games: 0, wins: 0, losses: 0, ...extra });
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

function mkRoom(humans: Record<number, string>) {
  const room = createRoom({ code: 'HIST', fillWithBots: true });
  for (const [k, pid] of Object.entries(humans)) {
    const s = Number(k);
    room.players[s]!.token = `tok${s}`;
    room.players[s]!.playerId = pid;
    room.players[s]!.name = pid.toUpperCase();
    room.players[s]!.ws = { readyState: 1, send: () => undefined } as never;
  }
  return room;
}

describe('S4-01 historial', () => {
  beforeEach(() => {
    docs.clear();
    repo.list.length = 0;
    setResultRepo(repo);
    pairs.map.clear();
    setPairRepo(pairs);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    setResultRepo(null);
    setPairRepo(null);
    vi.restoreAllMocks();
  });

  it('rachas: + victorias seguidas, − derrotas seguidas', () => {
    expect(nextStreak(0, true)).toBe(1);
    expect(nextStreak(3, true)).toBe(4);
    expect(nextStreak(3, false)).toBe(-1);
    expect(nextStreak(-2, false)).toBe(-3);
    expect(nextStreak(-2, true)).toBe(1);
  });

  it('describe compañero y rivales; "pareja" si es tu pareja fija', () => {
    const room = mkRoom({ 0: 'ana', 2: 'bea', 1: 'cris' });
    expect(describeTable(room, 0)).toEqual({
      kind: 'online',
      mate: { name: 'BEA', bot: false },
      rivals: [{ name: 'CRIS', bot: false }, { name: room.players[3]!.name, bot: true }],
    });
    room.players[0]!.partyCode = 'P1';
    room.players[2]!.partyCode = 'P1';
    expect(describeTable(room, 2).kind).toBe('pareja');
  });

  it('al acabar la partida: un registro por humano con ELO antes/después, y rachas', async () => {
    player('ana', { streak: 2, bestStreak: 2 });
    player('bea', { streak: -1, bestStreak: 4 });
    player('cris');
    const room = mkRoom({ 0: 'ana', 2: 'bea', 1: 'cris' });
    await updateEloOnHandEnd(room, 0);
    expect(repo.list).toHaveLength(3);
    const ana = repo.list.find((r) => r.playerId === 'ana')!;
    expect(ana).toMatchObject({ won: true, kind: 'online', ratingBefore: 1000, roomCode: 'HIST', mate: { name: 'BEA', bot: false } });
    expect(ana.ratingAfter).toBe(docs.get('ana')!.rating);
    const cris = repo.list.find((r) => r.playerId === 'cris')!;
    expect(cris.won).toBe(false);
    expect(cris.ratingAfter).toBeLessThan(1000);
    expect(docs.get('ana')).toMatchObject({ streak: 3, bestStreak: 3 });
    expect(docs.get('bea')).toMatchObject({ streak: 1, bestStreak: 4 });
    expect(docs.get('cris')).toMatchObject({ streak: -1, bestStreak: 0 });
  });

  it('S4-02: con cuenta, la división de la mesa se actualiza y avisa si cambia', async () => {
    // Ana (cuenta) en el borde de Oro tras 9 partidas: con esta se clasifica y sube.
    player('ana', { rating: 1045, games: 9, userId: 'g_1' });
    player('cris', { rating: 1000, games: 30 }); // invitado: sin división
    const room = mkRoom({ 0: 'ana', 1: 'cris' });
    const inbox: { type: string; [k: string]: unknown }[] = [];
    room.players[0]!.ws = { readyState: 1, send: (d: string) => inbox.push(JSON.parse(d)) } as never;
    await updateEloOnHandEnd(room, 0);
    expect(room.players[0]!.division).toBe('oro');
    expect(room.players[1]!.division).toBeUndefined();
    expect(inbox.find((m) => m.type === 'DIVISION_CHANGED')).toEqual({ type: 'DIVISION_CHANGED', from: null, to: 'oro' });
    expect(inbox.filter((m) => m.type === 'SEATS').at(-1)!.seatDivisions).toEqual(['oro', null, null, null]);
  });

  it('S4-08: rivales desde la misma conexión → partida marcada para revisar (sin castigo)', async () => {
    player('ana'); player('cris'); player('dani');
    const room = mkRoom({ 0: 'ana', 1: 'cris', 3: 'dani' });
    room.players[0]!.net = 'casa';
    room.players[1]!.net = 'casa';
    room.players[3]!.net = 'otra';
    await updateEloOnHandEnd(room, 0);
    expect(repo.list.every((r) => r.flag === 'misma_conexion')).toBe(true);
    expect(docs.get('ana')!.games).toBe(1); // el ELO se aplica igual
    // Compañeros en la misma conexión (pareja en casa): sin marca.
    repo.list.length = 0;
    room.players[1]!.net = 'otra';
    room.players[2]!.net = 'casa';
    await updateEloOnHandEnd(room, 1);
    expect(repo.list.some((r) => r.flag)).toBe(false);
  });

  it('S4-06: suma a la semana en curso y reinicia al cambiar de semana', async () => {
    const week = weekId();
    player('ana', { weekId: week, weekPoints: 10, weekGames: 2 });
    player('cris', { weekId: '2020-W01', weekPoints: 99, weekGames: 9 });
    await updateEloOnHandEnd(mkRoom({ 0: 'ana', 1: 'cris' }), 0);
    const ana = docs.get('ana')!;
    const cris = docs.get('cris')!;
    expect(ana).toMatchObject({ weekId: week, weekGames: 3, weekPoints: 10 + (ana.rating - 1000) });
    expect(cris).toMatchObject({ weekId: week, weekGames: 1, weekPoints: cris.rating - 1000 });
    expect(cris.weekPoints).toBeLessThan(0);
    expect(Date.parse(ana.lastPlayedAt!)).toBeGreaterThan(Date.now() - 5000);
  });

  it('S4-07: el tercer abandono en 24 h castiga 5 min sin buscar partida', async () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    player('ana');
    player('cris', { abandons: [recent, recent] });
    const room = mkRoom({ 0: 'ana', 1: 'cris' });
    substituteWithBot(room, 1, 'leave');
    await flush();
    const c = docs.get('cris')!;
    expect(c.abandons).toHaveLength(3);
    expect(Date.parse(c.queueBanUntil!)).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it('S4-05: pareja fija con cuenta → sube su nivel de pareja; sin cuenta, no', async () => {
    player('ana', { userId: 'g_a', publicName: 'Ana' });
    player('bea', { userId: 'g_b', publicName: 'Bea' });
    player('cris');
    const room = mkRoom({ 0: 'ana', 2: 'bea', 1: 'cris' });
    room.players[0]!.partyCode = 'P1';
    room.players[2]!.partyCode = 'P1';
    await updateEloOnHandEnd(room, 0);
    const p = (await pairs.get(pairId('ana', 'bea')))!;
    expect(p).toMatchObject({ games: 1, wins: 1 });
    expect(p.members.map((x) => x.name)).toEqual(['Ana', 'Bea']);
    // Sin cuenta uno de los dos: no hay pareja en el ranking.
    pairs.map.clear();
    delete docs.get('bea')!.userId;
    await updateEloOnHandEnd(room, 0);
    expect(pairs.map.size).toBe(0);
  });

  it('S4-09: primera partida de la temporada nueva → insignia y nivel reiniciado antes de calcular', async () => {
    player('ana', { rating: 1300, games: 40, seasonId: '2020-T2', seasonPeak: 1300 });
    player('cris', { seasonId: seasonId() });
    await updateEloOnHandEnd(mkRoom({ 0: 'ana', 1: 'cris' }), 0);
    const ana = docs.get('ana')!;
    expect(ana.seasonId).toBe(seasonId());
    expect(ana.seasonBadges).toEqual([{ season: '2020-T2', division: 'maestro' }]);
    // Empezó en 1150 (no en 1300) y ganó.
    expect(ana.rating).toBeGreaterThan(1150);
    expect(ana.rating).toBeLessThan(1180);
    expect(ana.seasonPeak).toBe(ana.rating);
    const hist = repo.list.find((r) => r.playerId === 'ana')!;
    expect(hist.ratingBefore).toBe(1150);
  });

  it('partida sin humanos en un equipo: no cuenta, no hay historial', async () => {
    player('ana');
    await updateEloOnHandEnd(mkRoom({ 0: 'ana' }), 0);
    expect(repo.list).toHaveLength(0);
  });

  it('abandonar a mitad: derrota marcada como abandono en el historial', async () => {
    player('ana');
    player('cris', { streak: 3, bestStreak: 3 });
    const room = mkRoom({ 0: 'ana', 1: 'cris' });
    substituteWithBot(room, 1, 'leave');
    await flush();
    expect(repo.list).toHaveLength(1);
    expect(repo.list[0]).toMatchObject({ playerId: 'cris', won: false, abandoned: true, rivals: [{ name: room.players[2]!.name, bot: true }, { name: 'ANA', bot: false }] });
    expect(docs.get('cris')).toMatchObject({ streak: -1, bestStreak: 3 });
  });

  it('historial de varios dispositivos fusionados, mezclado por fecha', async () => {
    const base = { kind: 'online' as const, won: true, ratingBefore: 1000, ratingAfter: 1010, mate: null, rivals: [], roomCode: 'X' };
    await recordResult({ ...base, playerId: 'pc', at: '2026-10-01T10:00:00Z' });
    await recordResult({ ...base, playerId: 'movil', at: '2026-10-03T10:00:00Z' });
    await recordResult({ ...base, playerId: 'pc', at: '2026-10-02T10:00:00Z' });
    await recordResult({ ...base, playerId: 'otro', at: '2026-10-04T10:00:00Z' });
    const list = await recentFor(['pc', 'movil', 'pc'], 10, repo);
    expect(list.map((r) => r.at.slice(0, 10))).toEqual(['2026-10-03', '2026-10-02', '2026-10-01']);
    expect((await recentFor(['pc', 'movil'], 2, repo))).toHaveLength(2);
  });

  it('si falla guardar el historial, no rompe nada', async () => {
    setResultRepo({ add: async () => { throw Object.assign(new Error('no existe'), { code: 404 }); }, recent: async () => [], removeAll: async () => undefined });
    player('ana'); player('cris');
    await expect(updateEloOnHandEnd(mkRoom({ 0: 'ana', 1: 'cris' }), 0)).resolves.toBeUndefined();
    expect(docs.get('ana')!.games).toBe(1);
  });
});
