/**
 * S4-01: historial de partidas.
 *
 * Un documento por jugador y partida con ELO (las que cuentan: online con
 * al menos un humano en cada equipo, o abandono con rivales humanos).
 * Contenedor Cosmos `results`, PK `/playerId` → leer tu historial es una
 * consulta dentro de una sola partición (barata).
 *
 * Todo es "mejor esfuerzo": si falla guardar el historial, el ELO y la
 * partida siguen igual.
 */
import type { Container } from '@azure/cosmos';
import { getCosmosHandles } from './globalHandles.js';
import type { Room } from './room.js';

export interface ResultPlayer {
  name: string;
  bot: boolean;
}

export interface MatchResult {
  id: string;
  playerId: string;
  /** ISO. */
  at: string;
  /** `pareja` = jugaste con tu pareja fija (S3-04). */
  kind: 'online' | 'pareja';
  won: boolean;
  /** Derrota por abandonar a mitad (S2-12). */
  abandoned?: boolean;
  ratingBefore: number;
  ratingAfter: number;
  mate: ResultPlayer | null;
  rivals: ResultPlayer[];
  roomCode: string;
}

export interface ResultRepo {
  add(r: MatchResult): Promise<void>;
  /** Las más recientes primero. */
  recent(playerId: string, limit: number): Promise<MatchResult[]>;
  /** RGPD: borra todo el historial de un jugador. */
  removeAll(playerId: string): Promise<void>;
}

export class MemoryResultRepo implements ResultRepo {
  readonly list: MatchResult[] = [];
  async add(r: MatchResult) {
    this.list.push(structuredClone(r));
  }
  async recent(playerId: string, limit: number) {
    return this.list
      .filter((r) => r.playerId === playerId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async removeAll(playerId: string) {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.playerId === playerId) this.list.splice(i, 1);
  }
}

export class CosmosResultRepo implements ResultRepo {
  constructor(private readonly c: Container) {}
  async add(r: MatchResult) {
    await this.c.items.create(r);
  }
  async recent(playerId: string, limit: number) {
    const { resources } = await this.c.items
      .query<MatchResult>(
        {
          query: 'SELECT TOP @n * FROM c WHERE c.playerId = @p ORDER BY c.at DESC',
          parameters: [
            { name: '@n', value: limit },
            { name: '@p', value: playerId },
          ],
        },
        { partitionKey: playerId },
      )
      .fetchAll();
    return resources.map(({ id, playerId: pid, at, kind, won, abandoned, ratingBefore, ratingAfter, mate, rivals, roomCode }) => ({
      id,
      playerId: pid,
      at,
      kind,
      won,
      ...(abandoned ? { abandoned } : {}),
      ratingBefore,
      ratingAfter,
      mate,
      rivals,
      roomCode,
    }));
  }
  async removeAll(playerId: string) {
    const { resources } = await this.c.items
      .query<{ id: string }>(
        { query: 'SELECT c.id FROM c WHERE c.playerId = @p', parameters: [{ name: '@p', value: playerId }] },
        { partitionKey: playerId },
      )
      .fetchAll();
    for (const { id } of resources) await this.c.item(id, playerId).delete();
  }
}

/**
 * Historial de varios players (la cuenta y los que se le fusionaron),
 * mezclado y ordenado, los más recientes primero.
 */
export async function recentFor(playerIds: string[], limit: number, repo: ResultRepo = resultRepo()): Promise<MatchResult[]> {
  const lists = await Promise.all([...new Set(playerIds)].map((id) => repo.recent(id, limit)));
  return lists
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

let override: ResultRepo | null = null;
const memory = new MemoryResultRepo();

/** Para tests. */
export function setResultRepo(r: ResultRepo | null): void {
  override = r;
}

export function resultRepo(): ResultRepo {
  if (override) return override;
  const h = getCosmosHandles();
  return h ? new CosmosResultRepo(h.results) : memory;
}

/** Compañero y rivales vistos desde un asiento (equipos 0-2 y 1-3). */
export function describeTable(room: Room, seat: number): Pick<MatchResult, 'kind' | 'mate' | 'rivals'> {
  const who = (s: number): ResultPlayer => {
    const p = room.players[s]!;
    return { name: p.name, bot: p.token === null };
  };
  const mateSeat = (seat + 2) % 4;
  const me = room.players[seat]!;
  const mate = room.players[mateSeat]!;
  const kind = me.partyCode && mate.partyCode === me.partyCode ? 'pareja' : 'online';
  return { kind, mate: who(mateSeat), rivals: [who((seat + 1) % 4), who((seat + 3) % 4)] };
}

/** Racha: positiva = victorias seguidas, negativa = derrotas seguidas. */
export function nextStreak(streak: number, won: boolean): number {
  if (won) return streak > 0 ? streak + 1 : 1;
  return streak < 0 ? streak - 1 : -1;
}

export async function recordResult(r: Omit<MatchResult, 'id' | 'at'> & { at?: string }): Promise<void> {
  try {
    await resultRepo().add({ id: globalThis.crypto.randomUUID(), at: r.at ?? new Date().toISOString(), ...r });
  } catch (err) {
    const e = err as { code?: number | string; message?: string };
    console.log(`[historial] no se pudo guardar (code=${e.code ?? '?'}): ${e.message ?? ''}`);
  }
}
