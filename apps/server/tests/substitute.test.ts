import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S2-12 — Desconexión y sustitución por bot (decisiones 2026-10-18):
 * sin reclamar tras 90 s, y abandonar a mitad de partida = derrota de ELO.
 * Cosmos se simula con un Map en memoria.
 */
const docs = new Map<string, { id: string; rating: number; games: number; wins: number; losses: number }>();
const fakeCosmos = {
  players: {
    item: (id: string) => ({ read: async () => ({ resource: docs.get(id) }) }),
    items: { upsert: async (d: { id: string }) => { docs.set(d.id, d as never); return {}; } },
  },
};
vi.mock('../src/globalHandles.js', () => ({ getCosmosHandles: () => fakeCosmos, setCosmosHandles: () => undefined }));

const { createRoom, substituteWithBot, seatKinds, isMidPartida, triggerNextHand, castRematchVote } = await import('../src/room.js');
type Room = ReturnType<typeof createRoom>;

const player = (id: string, rating = 1000) => docs.set(id, { id, rating, games: 0, wins: 0, losses: 0 });
const flush = () => new Promise((r) => setImmediate(r));

function mkRoom(humans: Record<number, string>) {
  const room = createRoom({ code: 'SUBS', fillWithBots: true });
  const inbox: Record<number, any[]> = {};
  for (const [k, pid] of Object.entries(humans)) {
    const s = Number(k);
    inbox[s] = [];
    room.players[s]!.token = `tok${s}`;
    room.players[s]!.playerId = pid;
    room.players[s]!.name = `H${s}`;
    room.players[s]!.ws = { readyState: 1, send: (d: string) => inbox[s]!.push(JSON.parse(d)) } as never;
  }
  return { room, inbox };
}

describe('S2-12 sustitución por bot', () => {
  beforeEach(() => {
    docs.clear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('a mitad de partida: el asiento pasa a bot sustituto y se avisa con SEATS', () => {
    player('pA'); player('pB');
    const { room, inbox } = mkRoom({ 0: 'pA', 1: 'pB' });
    expect(isMidPartida(room)).toBe(true);
    substituteWithBot(room, 1, 'leave');
    const p = room.players[1]!;
    expect(p.token).toBeNull();
    expect(p.substitute).toBe(true);
    expect(p.playerId).toBeUndefined();
    expect(p.name).toBe('H1 (bot)');
    expect(room.abandonedPlayerIds.has('pB')).toBe(true);
    expect(seatKinds(room)).toEqual(['human', 'substitute', 'bot', 'bot']);
    const seats = [...inbox[0]!].reverse().find((m) => m.type === 'SEATS');
    expect(seats.seatKinds[1]).toBe('substitute');
  });

  it('un humano desconectado (ws null) se ve como "disconnected"', () => {
    const { room } = mkRoom({ 0: 'pA', 1: 'pB' });
    room.players[1]!.ws = null;
    expect(seatKinds(room)[1]).toBe('disconnected');
  });

  it('abandonar a mitad de partida cuenta como derrota de ELO contra los rivales humanos', async () => {
    player('pA'); player('pB');
    const { room } = mkRoom({ 0: 'pA', 1: 'pB' });
    substituteWithBot(room, 1, 'timeout');
    await flush(); await flush();
    const b = docs.get('pB')!;
    expect(b.rating).toBe(980); // K=40, misma media → -20
    expect(b.games).toBe(1);
    expect(b.losses).toBe(1);
    expect(docs.get('pA')!.games).toBe(0); // el rival no cambia hasta el final de la partida
  });

  it('sin rivales humanos (partida contra bots) el abandono no cuenta', async () => {
    player('pA'); player('pC');
    const { room } = mkRoom({ 0: 'pA', 2: 'pC' }); // mismo equipo, rivales bots
    substituteWithBot(room, 0, 'leave');
    await flush(); await flush();
    expect(docs.get('pA')!.games).toBe(0);
  });

  it('el abandonado ya no entra en el ELO de fin de partida (no se le penaliza dos veces)', async () => {
    player('pA'); player('pB'); player('pD');
    const { room } = mkRoom({ 0: 'pA', 1: 'pB', 3: 'pD' });
    substituteWithBot(room, 1, 'leave');
    await flush(); await flush();
    expect(docs.get('pB')!.games).toBe(1);
    expect(room.players.map((p) => p.playerId)).not.toContain('pB');
  });

  it('entre partidas (postgame) el sustituto vota "yes" y no hay penalización', async () => {
    player('pA'); player('pB');
    const { room } = mkRoom({ 0: 'pA', 1: 'pB' });
    const st = room.state!;
    st.phase = 'finished'; st.matchEnded = true; st.matchWinner = 0; st.turn = null;
    vi.useFakeTimers();
    triggerNextHand(room);
    expect(room.postgame).not.toBeNull();
    expect(isMidPartida(room)).toBe(false);
    castRematchVote(room, 0, true);
    substituteWithBot(room, 1, 'timeout'); // con eso hay unanimidad → nueva partida
    expect(room.postgame).toBeNull();
    expect(room.state!.phase).not.toBe('finished');
    vi.clearAllTimers(); vi.useRealTimers();
    await flush();
    expect(docs.get('pB')!.games).toBe(0);
  });
});
