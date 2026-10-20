/**
 * S4-05: ranking de parejas.
 *
 * Cada pareja fija (dos jugadores **con cuenta** que juegan juntos como
 * pareja de S3-04) tiene su propio nivel, que solo se mueve cuando juegan
 * juntos una partida con ELO. Contenedor Cosmos `pairs` (PK `/id`, id =
 * los dos playerId ordenados, "a|b").
 *
 * El rival es la otra pareja (su nivel de pareja) o, si son dos sueltos,
 * la media de sus niveles individuales.
 */
import type { Container } from '@azure/cosmos';
import { applyElo } from './elo.js';
import { getCosmosHandles } from './globalHandles.js';
import { divisionOfRating, type Division } from '@guinote/protocol';

export const PAIR_MIN_GAMES = 5;

export interface PairMember {
  playerId: string;
  name: string;
  tag: string;
  province: string | null;
  municipio: string | null;
}

export interface PairDoc {
  id: string;
  players: [string, string];
  members: [PairMember, PairMember];
  rating: number;
  games: number;
  wins: number;
  losses: number;
  lastPlayedAt: string;
  /** Provincia/pueblo de la pareja: solo si los dos son del mismo sitio. */
  place: { province: string | null; municipio: string | null };
}

export function pairId(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export interface PairRepo {
  get(id: string): Promise<PairDoc | null>;
  put(p: PairDoc): Promise<void>;
  /** Parejas en las que está este jugador. */
  forPlayer(playerId: string): Promise<PairDoc[]>;
  /** Clasificadas (≥ 5 partidas, activas desde `since`) de un ámbito, por nivel. */
  top(scope: PairScope, since: string, limit: number): Promise<PairDoc[]>;
  countAbove(scope: PairScope, since: string, rating: number): Promise<number>;
  /** RGPD: quita al jugador de sus parejas (borra esas parejas). */
  removePlayer(playerId: string): Promise<void>;
}

export type PairScope = { kind: 'es' } | { kind: 'prov'; province: string } | { kind: 'mun'; municipio: string };

function inScope(p: PairDoc, s: PairScope): boolean {
  if (s.kind === 'prov') return p.place.province === s.province;
  if (s.kind === 'mun') return p.place.municipio === s.municipio;
  return true;
}

export class MemoryPairRepo implements PairRepo {
  readonly map = new Map<string, PairDoc>();
  async get(id: string) {
    const p = this.map.get(id);
    return p ? structuredClone(p) : null;
  }
  async put(p: PairDoc) {
    this.map.set(p.id, structuredClone(p));
  }
  async forPlayer(pid: string) {
    return [...this.map.values()].filter((p) => p.players.includes(pid)).map((p) => structuredClone(p));
  }
  private ranked(scope: PairScope, since: string) {
    return [...this.map.values()].filter((p) => p.games >= PAIR_MIN_GAMES && p.lastPlayedAt >= since && inScope(p, scope));
  }
  async top(scope: PairScope, since: string, limit: number) {
    return this.ranked(scope, since)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }
  async countAbove(scope: PairScope, since: string, rating: number) {
    return this.ranked(scope, since).filter((p) => p.rating > rating).length;
  }
  async removePlayer(pid: string) {
    for (const [id, p] of this.map) if (p.players.includes(pid)) this.map.delete(id);
  }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: number }).code === 404;
}

export class CosmosPairRepo implements PairRepo {
  constructor(private readonly c: Container) {}
  async get(id: string) {
    try {
      const { resource } = await this.c.item(id, id).read<PairDoc>();
      return resource ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  async put(p: PairDoc) {
    await this.c.items.upsert(p);
  }
  async forPlayer(pid: string) {
    const { resources } = await this.c.items
      .query<PairDoc>({ query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(c.players, @p)', parameters: [{ name: '@p', value: pid }] })
      .fetchAll();
    return resources;
  }
  private where(scope: PairScope) {
    const base = 'c.games >= @g AND c.lastPlayedAt >= @since';
    if (scope.kind === 'prov') return { sql: `${base} AND c.place.province = @x`, params: [{ name: '@x', value: scope.province }] };
    if (scope.kind === 'mun') return { sql: `${base} AND c.place.municipio = @x`, params: [{ name: '@x', value: scope.municipio }] };
    return { sql: base, params: [] as { name: string; value: string }[] };
  }
  async top(scope: PairScope, since: string, limit: number) {
    const w = this.where(scope);
    const { resources } = await this.c.items
      .query<PairDoc>({
        query: `SELECT TOP @n * FROM c WHERE ${w.sql} ORDER BY c.rating DESC`,
        parameters: [{ name: '@n', value: limit }, { name: '@g', value: PAIR_MIN_GAMES }, { name: '@since', value: since }, ...w.params],
      })
      .fetchAll();
    return resources;
  }
  async countAbove(scope: PairScope, since: string, rating: number) {
    const w = this.where(scope);
    const { resources } = await this.c.items
      .query<number>({
        query: `SELECT VALUE COUNT(1) FROM c WHERE ${w.sql} AND c.rating > @r`,
        parameters: [{ name: '@g', value: PAIR_MIN_GAMES }, { name: '@since', value: since }, { name: '@r', value: rating }, ...w.params],
      })
      .fetchAll();
    return resources[0] ?? 0;
  }
  async removePlayer(pid: string) {
    for (const p of await this.forPlayer(pid)) {
      try {
        await this.c.item(p.id, p.id).delete();
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
  }
}

/** Lo que el hook de fin de partida sabe de cada humano. */
export interface PairSide {
  /** Los dos de la pareja (mismo `partyCode`, ambos con cuenta), o null. */
  pair: [PairMember, PairMember] | null;
  /** Media del nivel individual de los humanos de ese equipo. */
  meanRating: number;
}

function freshPair(a: PairMember, b: PairMember, now: string): PairDoc {
  const [m1, m2] = [a, b].sort((x, y) => x.playerId.localeCompare(y.playerId)) as [PairMember, PairMember];
  return {
    id: pairId(a.playerId, b.playerId),
    players: [m1.playerId, m2.playerId],
    members: [m1, m2],
    rating: 1000,
    games: 0,
    wins: 0,
    losses: 0,
    lastPlayedAt: now,
    place: { province: null, municipio: null },
  };
}

function samePlace(a: PairMember, b: PairMember): PairDoc['place'] {
  return {
    province: a.province && a.province === b.province ? a.province : null,
    municipio: a.municipio && a.municipio === b.municipio ? a.municipio : null,
  };
}

/**
 * Actualiza el nivel de las parejas fijas de la mesa al acabar una
 * partida con ELO. `sides[team]`; `winner` = equipo ganador.
 * Devuelve las parejas actualizadas (para logs/tests).
 */
export async function updatePairs(repo: PairRepo, sides: Record<0 | 1, PairSide>, winner: 0 | 1, now: Date = new Date()): Promise<PairDoc[]> {
  const iso = now.toISOString();
  const docs: Partial<Record<0 | 1, PairDoc>> = {};
  for (const t of [0, 1] as const) {
    const pr = sides[t].pair;
    if (!pr) continue;
    docs[t] = (await repo.get(pairId(pr[0].playerId, pr[1].playerId))) ?? freshPair(pr[0], pr[1], iso);
  }
  const out: PairDoc[] = [];
  for (const t of [0, 1] as const) {
    const doc = docs[t];
    if (!doc) continue;
    const other = (1 - t) as 0 | 1;
    const oppRating = docs[other]?.rating ?? sides[other].meanRating;
    const won = t === winner;
    const { deltaA } = applyElo(doc.rating, oppRating, won ? 1 : 0, doc.games);
    const pr = sides[t].pair!;
    const sorted = [...pr].sort((x, y) => x.playerId.localeCompare(y.playerId)) as [PairMember, PairMember];
    const next: PairDoc = {
      ...doc,
      members: sorted, // nombres y sitios al día
      place: samePlace(sorted[0], sorted[1]),
      rating: doc.rating + deltaA,
      games: doc.games + 1,
      wins: doc.wins + (won ? 1 : 0),
      losses: doc.losses + (won ? 0 : 1),
      lastPlayedAt: iso,
    };
    await repo.put(next);
    out.push(next);
  }
  return out;
}

let override: PairRepo | null = null;
const memory = new MemoryPairRepo();

/** Para tests. */
export function setPairRepo(r: PairRepo | null): void {
  override = r;
}

export function pairRepo(): PairRepo {
  if (override) return override;
  const h = getCosmosHandles();
  return h ? new CosmosPairRepo(h.pairs) : memory;
}

// ───────────── Ranking de parejas ─────────────

export interface PairEntry {
  pos: number;
  name: string;
  tag: string;
  points: number;
  rating: number;
  division: Division | null;
  you: boolean;
}

const cache = new Map<string, { at: number; rows: PairDoc[] }>();

/** Para tests. */
export function _clearPairCache(): void {
  cache.clear();
}

export function pairName(p: PairDoc): string {
  return `${p.members[0].name} & ${p.members[1].name}`;
}

/** Top de parejas (caché de 1 minuto). `youId` = tu playerId, para marcar tus parejas. */
export async function topPairEntries(repo: PairRepo, scope: PairScope, since: string, youId: string | null, now: number = Date.now()): Promise<PairEntry[]> {
  const key = scope.kind === 'es' ? 'es' : scope.kind === 'prov' ? `p:${scope.province}` : `m:${scope.municipio}`;
  let hit = cache.get(key);
  if (!hit || now - hit.at > 60_000) {
    hit = { at: now, rows: await repo.top(scope, since, 100) };
    cache.set(key, hit);
  }
  return hit.rows.map((p, i) => ({
    pos: i + 1,
    name: pairName(p),
    tag: '',
    points: Math.round(p.rating),
    rating: Math.round(p.rating),
    division: divisionOfRating(p.rating),
    you: !!youId && p.players.includes(youId),
  }));
}
