/**
 * Identidad anónima de los jugadores: cookie httpOnly con `playerId`
 * UUID + documento en Cosmos (`players` container, PK `/id`).
 *
 * Decisión Sprint 2-17 (2026-10-17):
 *  - **Sin cuentas**. Borrar cookies o cambiar de dispositivo = nuevo
 *    playerId = nuevo rating. Decisión consciente para MVP.
 *  - **Cookie httpOnly + sameSite=lax** con `playerId` UUID.
 *    No es accesible por JS, no se envía cross-site. SameSite=lax
 *    permite que enlaces desde el mismo dominio funcionen.
 *  - **Persistencia en `players`** (PK `/id`). Documento:
 *    `{ id, name?, rating, games, wins, losses, createdAt }`.
 *  - **Rating inicial 1000**. Se actualiza vía `applyElo` al final de
 *    cada partida (en S2-17 pieza 3, ver SPRINT2.md).
 *
 * La cookie la emite el server en el primer POST `/api/rooms` (o
 * `/api/rooms/matchmake`) si no existe. La respuesta del POST incluye
 * el `playerId` para que el cliente lo guarde también (y lo mande en
 * el WS handshake junto al `token`).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CosmosHandles } from './persistence/cosmosClient.js';

export const PLAYER_COOKIE = 'guinote_pid';
/** 90 días: mientras la cookie viva, el jugador mantiene su rating. */
export const PLAYER_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;

export interface Player {
  id: string;
  name?: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  createdAt: string;
  /** S4-01: racha actual (+ victorias seguidas, − derrotas seguidas). */
  streak?: number;
  /** S4-01: mejor racha de victorias. */
  bestStreak?: number;
  /** S4-03: de dónde eres (provincia y municipio INE); null = no lo dices. */
  place?: { province: string; municipio: string | null } | null;
  /** S4-03: último cambio de `place` (ISO), para el límite de 30 días. */
  placeChangedAt?: string;
}

/**
 * Parsea el header `Cookie` y devuelve el valor de `guinote_pid` si
 * existe. Devuelve `null` si no está.
 */
export function readPlayerIdFromCookie(req: FastifyRequest): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === PLAYER_COOKIE && v) return v;
  }
  return null;
}

/**
 * Setea la cookie `guinote_pid` en la respuesta. `Secure` se activa
 * cuando el request viene por HTTPS (en local con HTTP va sin flag).
 */
export function setPlayerCookie(reply: FastifyReply, playerId: string, isHttps: boolean): void {
  const flags = [
    `${PLAYER_COOKIE}=${playerId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${PLAYER_COOKIE_MAX_AGE}`,
  ];
  if (isHttps) flags.push('Secure');
  reply.header('Set-Cookie', flags.join('; '));
}

/**
 * Resultado de `ensurePlayer`: el `playerId` y el documento del player.
 * Si el playerId venía de la cookie y existe en Cosmos, lo devuelve
 * tal cual. Si no existía, lo crea con rating inicial.
 */
export interface PlayerLookup {
  playerId: string;
  player: Player;
}

/**
 * Asegura que existe un player. Si `playerId` es null (no venía en
 * cookie), genera uno nuevo. En cualquier caso, lee el documento de
 * Cosmos o lo crea con rating inicial.
 *
 * Pensado para llamarse en POST /api/rooms y /api/rooms/matchmake
 * ANTES de meter al jugador en una sala.
 */
export async function ensurePlayer(
  cosmos: CosmosHandles,
  playerId: string | null,
): Promise<PlayerLookup> {
  const id = playerId ?? globalThis.crypto.randomUUID();
  try {
    const { resource } = await cosmos.players.item(id, id).read();
    if (resource) {
      // Cosmos devuelve el doc tal cual lo guardamos (incluye `id`).
      return { playerId: id, player: resource as Player };
    }
  } catch {
    // 404 o similar: el player no existe, caemos al upsert de abajo.
  }
  // Crear el player con rating inicial.
  const fresh: Player = {
    id,
    rating: 1000,
    games: 0,
    wins: 0,
    losses: 0,
    createdAt: new Date().toISOString(),
  };
  await cosmos.players.items.upsert(fresh);
  return { playerId: id, player: fresh };
}

/**
 * Actualiza el documento del player después de una partida.
 * Solo modifica `rating`, `games`, `wins`, `losses`. No toca
 * `createdAt` ni `name`.
 */
export async function updatePlayerRating(
  cosmos: CosmosHandles,
  playerId: string,
  patch: Partial<Pick<Player, 'rating' | 'games' | 'wins' | 'losses' | 'streak' | 'bestStreak'>>,
): Promise<void> {
  const { resource } = await cosmos.players.item(playerId, playerId).read();
  if (!resource) {
    // No debería pasar si ensurePlayer se llamó antes, pero por si
    // acaso: creamos con el patch aplicado.
    const fallback: Player = {
      id: playerId,
      rating: 1000,
      games: 0,
      wins: 0,
      losses: 0,
      createdAt: new Date().toISOString(),
      ...patch,
    };
    await cosmos.players.items.upsert(fallback);
    return;
  }
  const updated: Player = { ...(resource as Player), ...patch };
  await cosmos.players.items.upsert(updated);
}