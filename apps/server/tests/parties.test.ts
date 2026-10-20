import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRoomStore, setRoomStore } from '../src/rooms.js';
import { MemoryRoomStore } from '../src/persistence/memory.js';
import { BOT_FILL_AFTER_MS, _clearQueue, formTables, isInQueue, listQueue } from '../src/matchmaking.js';
import { startQueuedTable } from '../src/queueRoom.js';
import {
  PARTY_ONLINE_MS,
  _resetParties,
  cancelPartySearch,
  createParty,
  getParty,
  joinParty,
  leaveParty,
  playParty,
  viewParty,
} from '../src/parties.js';

/** S3-04 — pareja fija: grupo de 2 que busca partida junto (cola de S3-05). */
function pairReady(t0 = Date.now()) {
  const { party, memberId: lead } = createParty('Jose', t0, 'pid-jose');
  const j = joinParty(party.code, 'Pilar', t0, 'pid-pilar');
  if (!j.ok) throw new Error('join');
  return { party, lead, mate: j.memberId };
}

describe('S3-04 pareja fija', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setRoomStore(new MemoryRoomStore());
    _resetParties();
    _clearQueue();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('crear, unirse, grupo lleno y salir (el liderazgo pasa al otro)', () => {
    const { party, lead, mate } = pairReady();
    expect(joinParty(party.code, 'Otro')).toEqual({ ok: false, error: 'full' });
    expect(joinParty('ZZZZ', 'x')).toEqual({ ok: false, error: 'not_found' });
    expect(viewParty(party, mate)).toMatchObject({
      youAreLeader: false,
      members: [
        { name: 'Jose', leader: true, you: false },
        { name: 'Pilar', leader: false, you: true },
      ],
      match: null,
    });
    leaveParty(party, lead);
    expect(viewParty(party, mate)?.youAreLeader).toBe(true);
    leaveParty(party, mate);
    expect(getParty(party.code)).toBeUndefined();
  });

  it('solo busca el líder, con los dos dentro y conectados', () => {
    const t0 = Date.now();
    const { party: solo, memberId } = createParty('Jose', t0);
    expect(playParty(solo, memberId, {}, t0)).toEqual({ ok: false, error: 'Falta tu pareja' });
    const { party, lead, mate } = pairReady(t0);
    expect(playParty(party, mate, {}, t0)).toMatchObject({ ok: false });
    // Pilar dejó de preguntar hace rato (p. ej. sigue en otra mesa).
    const r = playParty(party, lead, {}, t0 + PARTY_ONLINE_MS + 1);
    expect(r).toEqual({ ok: false, error: 'Pilar no está en la pantalla de la pareja' });
  });

  it('buscar: la pareja entra en la cola como una entrada de 2, con su ELO', () => {
    const { party, lead, mate } = pairReady();
    const r = playParty(party, lead, { [lead]: 1100, [mate]: 900 });
    expect(r.ok).toBe(true);
    expect(listQueue()).toHaveLength(1);
    expect(listQueue()[0]!.members).toEqual([
      { playerId: 'pid-jose', name: 'Jose', rating: 1100 },
      { playerId: 'pid-pilar', name: 'Pilar', rating: 900 },
    ]);
    expect(viewParty(party, mate)!.searchingMs).toBe(0);
    // Pulsar otra vez no la duplica.
    playParty(party, lead);
    expect(listQueue()).toHaveLength(1);
  });

  it('al formarse la mesa, los dos reciben su asiento enfrente', () => {
    const t0 = Date.now();
    const { party, lead, mate } = pairReady(t0);
    playParty(party, lead, {}, t0);
    const [table] = formTables(t0 + BOT_FILL_AFTER_MS);
    const room = startQueuedTable(table!);
    const vl = viewParty(party, lead)!;
    const vm = viewParty(party, mate)!;
    expect(vl.searchingMs).toBeNull();
    expect(vl.match!.roomCode).toBe(room.code);
    expect(vm.match!.id).toBe(vl.match!.id);
    expect(room.players[0]).toMatchObject({ name: 'Jose', token: vl.match!.token, partyCode: party.code, playerId: 'pid-jose' });
    expect(room.players[2]).toMatchObject({ name: 'Pilar', token: vm.match!.token, partyCode: party.code });
    expect(getRoomStore().get(room.code)).toBe(room);
  });

  it('cancelar (solo el líder) o salir de la pareja la saca de la cola', () => {
    const { party, lead, mate } = pairReady();
    playParty(party, lead);
    expect(cancelPartySearch(party, mate)).toBe(false);
    expect(listQueue()).toHaveLength(1);
    expect(cancelPartySearch(party, lead)).toBe(true);
    expect(listQueue()).toHaveLength(0);
    playParty(party, lead);
    leaveParty(party, mate);
    expect(isInQueue(`party:${party.code}`)).toBe(false);
  });
});
