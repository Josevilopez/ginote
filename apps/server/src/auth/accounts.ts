/**
 * S3-01: cuentas (opcionales) y su vínculo con los players anónimos.
 *
 * Un `player` (S2-17) es la identidad de juego: rating y partidas, ligado
 * a la cookie `guinote_pid`. Una cuenta (`users`, PK `/userId`) agrupa
 * uno o varios players de distintos dispositivos:
 *
 *  - Primer login: el player del dispositivo pasa a ser el **principal**
 *    de la cuenta (conserva su rating).
 *  - Login desde otro dispositivo con otro player: se **fusiona** en el
 *    principal (se suman partidas, victorias y derrotas; se queda el
 *    rating del que más partidas tenga) y queda en `linkedPlayerIds`.
 *  - A partir de ahí, en cualquier dispositivo con sesión se juega con el
 *    player principal.
 */
import type { Container } from '@azure/cosmos';
import type { Player } from '../players.js';

export interface User {
  id: string;
  userId: string;
  provider: 'google';
  /** `sub` de Google: identificador estable de la cuenta de Google. */
  sub: string;
  email?: string;
  name?: string;
  primaryPlayerId: string;
  linkedPlayerIds: string[];
  createdAt: string;
  lastLoginAt: string;
}

/** Player con campos de vínculo (opcionales para no romper docs viejos). */
export type LinkedPlayer = Player & { userId?: string; mergedInto?: string };

export interface UserRepo {
  get(userId: string): Promise<User | null>;
  put(user: User): Promise<void>;
  delete(userId: string): Promise<void>;
}

export interface PlayerRepo {
  get(id: string): Promise<LinkedPlayer | null>;
  put(player: LinkedPlayer): Promise<void>;
  delete(id: string): Promise<void>;
}

export function userIdForGoogle(sub: string): string {
  return `g_${sub}`;
}

export function freshPlayer(id: string): LinkedPlayer {
  return { id, rating: 1000, games: 0, wins: 0, losses: 0, createdAt: new Date().toISOString() };
}

/**
 * Fusiona `other` en `primary`: suma partidas y resultados; el rating es
 * el del que más partidas tenga (a igualdad, el del principal).
 */
export function mergePlayers(primary: LinkedPlayer, other: LinkedPlayer): LinkedPlayer {
  return {
    ...primary,
    rating: other.games > primary.games ? other.rating : primary.rating,
    games: primary.games + other.games,
    wins: primary.wins + other.wins,
    losses: primary.losses + other.losses,
  };
}

export interface LoginInput {
  sub: string;
  email?: string;
  name?: string;
  /** Player anónimo de este dispositivo (cookie `guinote_pid`), si hay. */
  devicePlayerId: string | null;
}

export interface LoginResult {
  user: User;
  /** Player con el que se juega a partir de ahora en este dispositivo. */
  playerId: string;
  created: boolean;
  merged: boolean;
}

export async function loginWithGoogle(
  users: UserRepo,
  players: PlayerRepo,
  input: LoginInput,
  now: Date = new Date(),
): Promise<LoginResult> {
  const userId = userIdForGoogle(input.sub);
  const nowIso = now.toISOString();
  const existing = await users.get(userId);
  const device = input.devicePlayerId ? await players.get(input.devicePlayerId) : null;
  // Un player de otra cuenta (dispositivo compartido) o ya fusionado no se toca.
  const deviceUsable = !!device && !device.mergedInto && (!device.userId || device.userId === userId);

  if (!existing) {
    const pid = deviceUsable ? device!.id : globalThis.crypto.randomUUID();
    const base = deviceUsable ? device! : freshPlayer(pid);
    const player: LinkedPlayer = { ...base, userId };
    if (input.name) player.name = input.name;
    await players.put(player);
    const user: User = {
      id: userId,
      userId,
      provider: 'google',
      sub: input.sub,
      primaryPlayerId: pid,
      linkedPlayerIds: [pid],
      createdAt: nowIso,
      lastLoginAt: nowIso,
    };
    if (input.email) user.email = input.email;
    if (input.name) user.name = input.name;
    await users.put(user);
    return { user, playerId: pid, created: true, merged: false };
  }

  const user: User = { ...existing, lastLoginAt: nowIso, linkedPlayerIds: [...existing.linkedPlayerIds] };
  if (input.email) user.email = input.email;
  if (input.name) user.name = input.name;
  let merged = false;
  if (deviceUsable && device!.id !== user.primaryPlayerId && !user.linkedPlayerIds.includes(device!.id)) {
    const primary = (await players.get(user.primaryPlayerId)) ?? { ...freshPlayer(user.primaryPlayerId), userId };
    if (device!.games > 0) {
      await players.put(mergePlayers(primary, device!));
      merged = true;
    } else if (!(await players.get(user.primaryPlayerId))) {
      await players.put(primary);
    }
    await players.put({ ...device!, userId, mergedInto: user.primaryPlayerId });
    user.linkedPlayerIds.push(device!.id);
  }
  await users.put(user);
  return { user, playerId: user.primaryPlayerId, created: false, merged };
}

/** RGPD: todo lo que guardamos de la cuenta. */
export async function exportAccount(users: UserRepo, players: PlayerRepo, userId: string): Promise<{ user: User; players: LinkedPlayer[] } | null> {
  const user = await users.get(userId);
  if (!user) return null;
  const list: LinkedPlayer[] = [];
  for (const id of user.linkedPlayerIds) {
    const p = await players.get(id);
    if (p) list.push(p);
  }
  return { user, players: list };
}

/** RGPD: borra la cuenta y sus players (rating y partidas incluidos). */
export async function deleteAccount(users: UserRepo, players: PlayerRepo, userId: string): Promise<boolean> {
  const user = await users.get(userId);
  if (!user) return false;
  for (const id of new Set([user.primaryPlayerId, ...user.linkedPlayerIds])) {
    await players.delete(id);
  }
  await users.delete(userId);
  return true;
}

// ───────────── Repos: memoria (dev / tests) y Cosmos ─────────────

export class MemoryUserRepo implements UserRepo {
  readonly map = new Map<string, User>();
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async put(u: User) {
    this.map.set(u.userId, structuredClone(u));
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

export class MemoryPlayerRepo implements PlayerRepo {
  readonly map = new Map<string, LinkedPlayer>();
  async get(id: string) {
    const p = this.map.get(id);
    return p ? structuredClone(p) : null;
  }
  async put(p: LinkedPlayer) {
    this.map.set(p.id, structuredClone(p));
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: number }).code === 404;
}

/** Contenedor `users`, PK `/userId`, `id = userId`. */
export class CosmosUserRepo implements UserRepo {
  constructor(private readonly c: Container) {}
  async get(id: string) {
    try {
      const { resource } = await this.c.item(id, id).read<User>();
      return resource ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  async put(u: User) {
    await this.c.items.upsert(u);
  }
  async delete(id: string) {
    try {
      await this.c.item(id, id).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}

/** Contenedor `players`, PK `/id`. */
export class CosmosPlayerRepo implements PlayerRepo {
  constructor(private readonly c: Container) {}
  async get(id: string) {
    try {
      const { resource } = await this.c.item(id, id).read<LinkedPlayer>();
      return resource ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  async put(p: LinkedPlayer) {
    await this.c.items.upsert(p);
  }
  async delete(id: string) {
    try {
      await this.c.item(id, id).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}
