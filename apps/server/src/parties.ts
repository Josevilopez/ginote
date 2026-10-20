/**
 * S3-04: pareja fija ("grupo de 2").
 *
 * Uno crea el grupo y comparte el enlace (`/#pareja-ABCD`); el otro se
 * une. Cuando están los dos, el que lo creó pulsa "Buscar partida" y la
 * pareja entra en la cola de "Jugar online" (S3-05) como una sola entrada
 * de 2: la mesa los sienta **enfrente** (mismo equipo: 0-2 o 1-3) contra
 * otra pareja o contra dos sueltos de nivel parecido; si no hay, bots.
 *
 * Los grupos viven en memoria (son efímeros: si el servidor se reinicia,
 * se vuelve a crear). Los clientes preguntan el estado cada segundo
 * mientras están en la pantalla de la pareja; así sabemos quién está
 * conectado y el compañero se entera de la mesa sin más protocolo.
 *
 * Asientos reservados: al formarse la mesa, cada miembro recibe un token
 * de asiento; su WebSocket entra con ese token como si reconectara.
 */
import { newRoomCode } from './roomCodes.js';
import { safeName } from './names.js';
import { dequeue, enqueue, type QueueEntry } from './matchmaking.js';

export const PARTY_SIZE = 2;
/** Un miembro cuenta como conectado si preguntó hace menos de esto. */
export const PARTY_ONLINE_MS = 5_000;
/** Un grupo sin actividad de nadie durante esto se borra. */
export const PARTY_TTL_MS = 3 * 60 * 60 * 1000;

export interface PartyMember {
  id: string;
  name: string;
  leader: boolean;
  lastSeen: number;
  /** Identidad de juego (ELO). Cookie o cuenta al crear/unirse. */
  playerId: string | null;
}

export interface PartyMatch {
  id: string;
  roomCode: string;
  tokens: Record<string, string>;
}

export interface Party {
  code: string;
  members: PartyMember[];
  match: PartyMatch | null;
  /** Epoch ms desde que la pareja está en la cola, o null. */
  searchingSince: number | null;
  updatedAt: number;
}

export interface PartyView {
  code: string;
  youAreLeader: boolean;
  members: { name: string; leader: boolean; online: boolean; you: boolean }[];
  /** Mesa a la que ir (con tu token de asiento), si ya se formó. */
  match: { id: string; roomCode: string; token: string } | null;
  /** Ms que lleva la pareja en la cola, o null si no está buscando. */
  searchingMs: number | null;
}

const parties = new Map<string, Party>();

/** Para tests. */
export function _resetParties(): void {
  parties.clear();
}

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

function cleanName(name: unknown): string {
  return safeName(name); // S4-08: sin nombres ofensivos
}

export function gcParties(now: number = Date.now()): void {
  for (const [code, p] of parties) {
    if (now - p.updatedAt > PARTY_TTL_MS || p.members.length === 0) parties.delete(code);
  }
}

export function createParty(name: unknown, now: number = Date.now(), playerId: string | null = null): { party: Party; memberId: string } {
  gcParties(now);
  let code = newRoomCode(4);
  while (parties.has(code)) code = newRoomCode(4);
  const memberId = uuid();
  const party: Party = {
    code,
    members: [{ id: memberId, name: cleanName(name), leader: true, lastSeen: now, playerId }],
    match: null,
    searchingSince: null,
    updatedAt: now,
  };
  parties.set(code, party);
  return { party, memberId };
}

export function getParty(code: string): Party | undefined {
  return parties.get(code.toUpperCase());
}

export type JoinResult = { ok: true; memberId: string } | { ok: false; error: 'not_found' | 'full' };

export function joinParty(code: string, name: unknown, now: number = Date.now(), playerId: string | null = null): JoinResult {
  const party = getParty(code);
  if (!party) return { ok: false, error: 'not_found' };
  if (party.members.length >= PARTY_SIZE) return { ok: false, error: 'full' };
  const memberId = uuid();
  party.members.push({ id: memberId, name: cleanName(name), leader: party.members.length === 0, lastSeen: now, playerId });
  party.updatedAt = now;
  return { ok: true, memberId };
}

/** Estado para un miembro; además apunta que sigue conectado. */
export function viewParty(party: Party, memberId: string, now: number = Date.now()): PartyView | null {
  const me = party.members.find((m) => m.id === memberId);
  if (!me) return null;
  me.lastSeen = now;
  party.updatedAt = now;
  const token = party.match?.tokens[memberId];
  return {
    code: party.code,
    youAreLeader: me.leader,
    members: party.members.map((m) => ({
      name: m.name,
      leader: m.leader,
      online: now - m.lastSeen < PARTY_ONLINE_MS,
      you: m.id === memberId,
    })),
    match: party.match && token ? { id: party.match.id, roomCode: party.match.roomCode, token } : null,
    searchingMs: party.searchingSince !== null ? now - party.searchingSince : null,
  };
}

export function leaveParty(party: Party, memberId: string, now: number = Date.now()): void {
  stopSearch(party);
  party.members = party.members.filter((m) => m.id !== memberId);
  if (party.members.length === 0) {
    parties.delete(party.code);
    return;
  }
  if (!party.members.some((m) => m.leader)) party.members[0]!.leader = true;
  party.match = null;
  party.updatedAt = now;
}

export function renameMember(party: Party, memberId: string, name: unknown): void {
  const m = party.members.find((x) => x.id === memberId);
  if (m) m.name = cleanName(name);
}

// ───────────── Buscar partida (cola de S3-05) ─────────────

function queueId(party: Party): string {
  return `party:${party.code}`;
}

function stopSearch(party: Party): void {
  if (party.searchingSince !== null) dequeue(queueId(party));
  party.searchingSince = null;
}

export type PlayResult = { ok: true; view: PartyView } | { ok: false; error: string };

/**
 * El líder pide partida: la pareja entra en la cola como una entrada de 2.
 * `ratings` es el ELO de cada miembro por `memberId` (lo lee el llamador).
 */
export function playParty(
  party: Party,
  memberId: string,
  ratings: Record<string, number> = {},
  now: number = Date.now(),
): PlayResult {
  const me = party.members.find((m) => m.id === memberId);
  if (!me) return { ok: false, error: 'No estás en esta pareja' };
  if (!me.leader) return { ok: false, error: 'Busca la partida quien creó la pareja' };
  if (party.members.length < PARTY_SIZE) return { ok: false, error: 'Falta tu pareja' };
  me.lastSeen = now;
  const partner = party.members.find((m) => m.id !== memberId)!;
  if (now - partner.lastSeen >= PARTY_ONLINE_MS) {
    return { ok: false, error: `${partner.name} no está en la pantalla de la pareja` };
  }
  if (party.searchingSince === null) {
    const members = party.members.slice();
    const entry: QueueEntry = {
      id: queueId(party),
      members: members.map((m) => ({ playerId: m.playerId, name: m.name, rating: ratings[m.id] ?? 1000 })),
      enqueuedAt: now,
      partyCode: party.code,
      notify: ({ roomCode, tokens }) => {
        const map: Record<string, string> = {};
        members.forEach((m, i) => {
          map[m.id] = tokens[i]!;
        });
        party.match = { id: globalThis.crypto.randomUUID(), roomCode, tokens: map };
        party.searchingSince = null;
        party.updatedAt = Date.now();
        console.log(`[pareja] ${party.code} → mesa ${roomCode}`);
      },
    };
    enqueue(entry);
    party.searchingSince = now;
  }
  party.updatedAt = now;
  return { ok: true, view: viewParty(party, memberId, now)! };
}

/** El líder deja de buscar. */
export function cancelPartySearch(party: Party, memberId: string): boolean {
  const me = party.members.find((m) => m.id === memberId);
  if (!me?.leader) return false;
  stopSearch(party);
  return true;
}

/** Si alguno deja de mirar la pantalla mientras buscan, se cancela la búsqueda. */
export function dropStaleSearches(now: number = Date.now()): void {
  for (const party of parties.values()) {
    if (party.searchingSince === null) continue;
    if (party.members.some((m) => now - m.lastSeen > 15_000)) stopSearch(party);
  }
}
