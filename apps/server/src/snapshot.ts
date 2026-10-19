import { GUINOTE_ARAGONES, type GameState, type Seat } from '@guinote/engine';
import type { MatchEndReason, Room } from './room.js';

/**
 * S2-14: snapshot serializable de una sala, para guardarlo en Cosmos
 * (`snapshots`, PK `/tableId`, TTL 24 h) y rehidratarla tras un reinicio.
 *
 * Se guarda TODO lo necesario para seguir jugando: estado del motor,
 * asientos (con tokens, para que los clientes reconecten a su asiento)
 * y la progresión del match. NO se guardan sockets ni timers: se
 * recrean al rehidratar (`resumeRestoredRoom` en `room.ts`).
 */
export interface RoomSnapshot {
  v: 1;
  code: string;
  players: Array<{
    seat: Seat;
    name: string;
    token: string | null;
    playerId?: string;
    substitute?: boolean;
  }>;
  state: GameState;
  matchWins: { 0: number; 1: number };
  /** Había votación de revancha abierta: se reabre con 20 s nuevos al rehidratar. */
  postgameOpen: boolean;
  matchFinished: boolean;
  matchChampion: 0 | 1 | null;
  matchEndReason: MatchEndReason | null;
  abandonedPlayerIds: string[];
  lobbyWindowMs: number;
  /** S2-10 (opcional: snapshots anteriores no lo traen → nivel por defecto). */
  botLevel?: 1 | 2;
  /** S3-03 (opcionales: snapshots anteriores → mesa pública). */
  isPrivate?: boolean;
  hostSeat?: Seat | null;
  /** S3-07 (opcionales: snapshots anteriores → 1 coto a 3, sin cotos). */
  format?: { partidasPorCoto: number; cotosParaGanar: number };
  cotoWins?: { 0: number; 1: number };
}

/** null si la sala no merece snapshot (lobby sin repartir). */
export function serializeRoom(room: Room): RoomSnapshot | null {
  if (room.state === null) return null;
  return {
    v: 1,
    code: room.code,
    players: room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      token: p.token,
      ...(p.playerId ? { playerId: p.playerId } : {}),
      ...(p.substitute ? { substitute: true } : {}),
    })),
    state: room.state,
    matchWins: { ...room.matchWins },
    postgameOpen: room.postgame !== null,
    matchFinished: room.matchFinished,
    matchChampion: room.matchChampion,
    matchEndReason: room.matchEndReason,
    abandonedPlayerIds: [...room.abandonedPlayerIds],
    lobbyWindowMs: room.lobbyWindowMs,
    botLevel: room.botLevel,
    isPrivate: room.isPrivate,
    hostSeat: room.hostSeat,
    format: { ...room.format },
    cotoWins: { ...room.cotoWins },
  };
}

/** Valida lo mínimo para no rehidratar basura (p. ej. los snapshots antiguos `{ code }`). */
export function isRoomSnapshot(x: unknown): x is RoomSnapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<RoomSnapshot>;
  return (
    s.v === 1 &&
    typeof s.code === 'string' &&
    Array.isArray(s.players) &&
    s.players.length === 4 &&
    !!s.state &&
    typeof s.state === 'object' &&
    Array.isArray((s.state as GameState).finishedTricks)
  );
}

/**
 * Reconstruye la `Room` en memoria. Los humanos quedan con `ws = null`
 * (desconectados) — `resumeRestoredRoom` les abre la ventana de 45 s.
 */
export function roomFromSnapshot(snap: RoomSnapshot): Room {
  // `rules` se toma del código, no del JSON: si un deploy ajusta reglas,
  // la partida rehidratada usa las del binario actual (y nunca un objeto
  // a medio deserializar).
  const state = { ...snap.state, rules: GUINOTE_ARAGONES } as GameState;
  return {
    code: snap.code,
    players: snap.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      token: p.token,
      ws: null,
      leaving: false,
      ...(p.playerId ? { playerId: p.playerId } : {}),
      ...(p.substitute ? { substitute: true } : {}),
    })),
    state,
    seenCommandIds: new Set(),
    log: [],
    autoPlayTimer: null,
    lobbyTimer: null,
    lobbyEndsAt: null,
    lobbyWindowMs: snap.lobbyWindowMs,
    matchWins: { ...snap.matchWins },
    postgame: null,
    matchFinished: snap.matchFinished,
    matchChampion: snap.matchChampion,
    matchEndReason: snap.matchEndReason,
    abandonedPlayerIds: new Set(snap.abandonedPlayerIds),
    botLevel: snap.botLevel ?? 2,
    isPrivate: snap.isPrivate ?? false,
    hostSeat: snap.hostSeat ?? null,
    format: snap.format ?? { partidasPorCoto: 3, cotosParaGanar: 1 },
    cotoWins: snap.cotoWins ? { ...snap.cotoWins } : { 0: 0, 1: 0 },
  };
}
