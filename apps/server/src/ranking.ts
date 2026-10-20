/**
 * S4-04: ranking individual.
 *
 * Quién sale: jugadores **con cuenta**, con ≥ 10 partidas con ELO
 * (`PLACEMENT_GAMES`) y que han jugado en los últimos 30 días. Se ordena
 * por ELO. Tres ámbitos: España, tu provincia y tu pueblo (S4-03).
 *
 * Los rankings se leen de Cosmos (`players`, consulta entre particiones
 * ordenada por rating) con una caché de 1 minuto por ámbito; tu puesto
 * es un COUNT de los que tienen más puntos que tú.
 */
import type { Container } from '@azure/cosmos';
import { PLACEMENT_GAMES, WEEK_MIN_GAMES, divisionFor, isOffensiveName, seasonId, weekId, type Division } from '@guinote/protocol';
import type { LinkedPlayer } from './auth/accounts.js';

export const RANKING_SIZE = 100;
export const ACTIVE_DAYS = 30;
export const RANKING_CACHE_MS = 60_000;

export type Scope = { kind: 'es' } | { kind: 'prov'; province: string } | { kind: 'mun'; municipio: string };

export interface RankRow {
  id: string;
  publicName: string;
  tag: string;
  rating: number;
  games: number;
  /** S4-06: puntos ganados en la semana (solo en el semanal). */
  weekPoints?: number;
}

export interface RankingSource {
  top(scope: Scope, activeSince: string, limit: number): Promise<RankRow[]>;
  /** Cuántos clasificados tienen más puntos que `rating` en ese ámbito. */
  countAbove(scope: Scope, activeSince: string, rating: number): Promise<number>;
  /** S4-06: semanal (≥ 3 partidas en `week`), por puntos ganados en la semana. */
  topWeek(scope: Scope, week: string, limit: number): Promise<RankRow[]>;
  countAboveWeek(scope: Scope, week: string, points: number): Promise<number>;
}

export type Period = 'all' | 'week';

/** S4-06: ¿sales en el semanal? */
export function weekEligibility(
  p: Pick<LinkedPlayer, 'userId' | 'mergedInto' | 'weekId' | 'weekGames'> | null,
  week: string = weekId(),
): { ok: true } | { ok: false; reason: 'no_account' | 'week_games'; gamesLeft?: number } {
  if (!p || !p.userId || p.mergedInto) return { ok: false, reason: 'no_account' };
  const games = p.weekId === week ? (p.weekGames ?? 0) : 0;
  if (games < WEEK_MIN_GAMES) return { ok: false, reason: 'week_games', gamesLeft: WEEK_MIN_GAMES - games };
  return { ok: true };
}

/** ¿Sale este jugador en el ranking? Si no, por qué. */
export function eligibility(
  p: Pick<LinkedPlayer, 'userId' | 'mergedInto' | 'games' | 'lastPlayedAt' | 'publicName' | 'seasonId'> | null,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: 'no_account' | 'placement' | 'inactive'; gamesLeft?: number } {
  if (!p || !p.userId || p.mergedInto) return { ok: false, reason: 'no_account' };
  if (p.games < PLACEMENT_GAMES) return { ok: false, reason: 'placement', gamesLeft: PLACEMENT_GAMES - p.games };
  if (!p.lastPlayedAt || Date.parse(p.lastPlayedAt) < now.getTime() - ACTIVE_DAYS * 86_400_000) {
    return { ok: false, reason: 'inactive' };
  }
  // S4-09: hay que haber jugado en la temporada actual.
  if (p.seasonId !== seasonId(now)) return { ok: false, reason: 'inactive' };
  return { ok: true };
}

export function activeSince(now: Date = new Date()): string {
  return new Date(now.getTime() - ACTIVE_DAYS * 86_400_000).toISOString();
}

function inScope(p: LinkedPlayer, scope: Scope): boolean {
  if (scope.kind === 'prov') return p.place?.province === scope.province;
  if (scope.kind === 'mun') return p.place?.municipio === scope.municipio;
  return true;
}

function rankable(p: LinkedPlayer, since: string): boolean {
  // S4-09: el general es de la temporada en curso (salen quienes han jugado en ella).
  return !!p.userId && !p.mergedInto && p.games >= PLACEMENT_GAMES && !!p.lastPlayedAt && p.lastPlayedAt >= since && p.seasonId === seasonId();
}

function row(p: LinkedPlayer): RankRow {
  return { id: p.id, publicName: p.publicName ?? 'Jugador', tag: p.tag ?? '0000', rating: p.rating, games: p.games };
}

/** Para tests y modo sin Cosmos: sobre un Map de players en memoria. */
export class MemoryRankingSource implements RankingSource {
  constructor(private readonly players: () => Iterable<LinkedPlayer>) {}
  private list(scope: Scope, since: string) {
    return [...this.players()].filter((p) => rankable(p, since) && inScope(p, scope));
  }
  async top(scope: Scope, since: string, limit: number) {
    return this.list(scope, since)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit)
      .map(row);
  }
  async countAbove(scope: Scope, since: string, rating: number) {
    return this.list(scope, since).filter((p) => p.rating > rating).length;
  }
  private weekList(scope: Scope, week: string) {
    return [...this.players()].filter(
      (p) => !!p.userId && !p.mergedInto && p.weekId === week && (p.weekGames ?? 0) >= WEEK_MIN_GAMES && inScope(p, scope),
    );
  }
  async topWeek(scope: Scope, week: string, limit: number) {
    return this.weekList(scope, week)
      .sort((a, b) => (b.weekPoints ?? 0) - (a.weekPoints ?? 0))
      .slice(0, limit)
      .map((p) => ({ ...row(p), weekPoints: p.weekPoints ?? 0 }));
  }
  async countAboveWeek(scope: Scope, week: string, points: number) {
    return this.weekList(scope, week).filter((p) => (p.weekPoints ?? 0) > points).length;
  }
}

export class CosmosRankingSource implements RankingSource {
  constructor(private readonly c: Container) {}
  private where(scope: Scope): { sql: string; params: { name: string; value: string | number }[] } {
    const base =
      'IS_DEFINED(c.userId) AND NOT IS_DEFINED(c.mergedInto) AND c.games >= @g AND c.lastPlayedAt >= @since AND c.seasonId = @season';
    if (scope.kind === 'prov') return { sql: `${base} AND c.place.province = @p`, params: [{ name: '@p', value: scope.province }] };
    if (scope.kind === 'mun') return { sql: `${base} AND c.place.municipio = @m`, params: [{ name: '@m', value: scope.municipio }] };
    return { sql: base, params: [] };
  }
  async top(scope: Scope, since: string, limit: number) {
    const w = this.where(scope);
    const { resources } = await this.c.items
      .query<RankRow>({
        query: `SELECT TOP @n c.id, c.publicName, c.tag, c.rating, c.games FROM c WHERE ${w.sql} ORDER BY c.rating DESC`,
        parameters: [{ name: '@n', value: limit }, { name: '@g', value: PLACEMENT_GAMES }, { name: '@since', value: since }, { name: '@season', value: seasonId() }, ...w.params],
      })
      .fetchAll();
    return resources.map((r) => ({ ...r, publicName: r.publicName ?? 'Jugador', tag: r.tag ?? '0000' }));
  }
  async countAbove(scope: Scope, since: string, rating: number) {
    const w = this.where(scope);
    const { resources } = await this.c.items
      .query<number>({
        query: `SELECT VALUE COUNT(1) FROM c WHERE ${w.sql} AND c.rating > @r`,
        parameters: [{ name: '@g', value: PLACEMENT_GAMES }, { name: '@since', value: since }, { name: '@season', value: seasonId() }, { name: '@r', value: rating }, ...w.params],
      })
      .fetchAll();
    return resources[0] ?? 0;
  }
  private whereWeek(scope: Scope) {
    const w = this.where(scope);
    // Mismos filtros de ámbito, pero sin los de partidas totales/actividad.
    const sql = w.sql.replace('c.games >= @g AND c.lastPlayedAt >= @since AND c.seasonId = @season', 'c.weekId = @w AND c.weekGames >= @wg');
    return { sql, params: w.params };
  }
  async topWeek(scope: Scope, week: string, limit: number) {
    const w = this.whereWeek(scope);
    const { resources } = await this.c.items
      .query<RankRow>({
        query: `SELECT TOP @n c.id, c.publicName, c.tag, c.rating, c.games, c.weekPoints FROM c WHERE ${w.sql} ORDER BY c.weekPoints DESC`,
        parameters: [{ name: '@n', value: limit }, { name: '@w', value: week }, { name: '@wg', value: WEEK_MIN_GAMES }, ...w.params],
      })
      .fetchAll();
    return resources.map((r) => ({ ...r, publicName: r.publicName ?? 'Jugador', tag: r.tag ?? '0000', weekPoints: r.weekPoints ?? 0 }));
  }
  async countAboveWeek(scope: Scope, week: string, points: number) {
    const w = this.whereWeek(scope);
    const { resources } = await this.c.items
      .query<number>({
        query: `SELECT VALUE COUNT(1) FROM c WHERE ${w.sql} AND c.weekPoints > @pts`,
        parameters: [{ name: '@w', value: week }, { name: '@wg', value: WEEK_MIN_GAMES }, { name: '@pts', value: points }, ...w.params],
      })
      .fetchAll();
    return resources[0] ?? 0;
  }
}

export interface RankingEntry {
  pos: number;
  name: string;
  tag: string;
  /** Puntos que ordenan: el ELO (general) o lo ganado en la semana (semanal). */
  points: number;
  rating: number;
  division: Division | null;
  you: boolean;
}

const cache = new Map<string, { at: number; rows: RankRow[] }>();

/** Para tests. */
export function _clearRankingCache(): void {
  cache.clear();
}

function scopeKey(s: Scope, period: Period): string {
  const k = s.kind === 'es' ? 'es' : s.kind === 'prov' ? `prov:${s.province}` : `mun:${s.municipio}`;
  return period === 'week' ? `week:${weekId()}:${k}` : k;
}

/** Top del ámbito (caché de 1 minuto) con puestos y división. */
export async function topEntries(
  source: RankingSource,
  scope: Scope,
  youId: string | null,
  now: Date = new Date(),
  period: Period = 'all',
): Promise<RankingEntry[]> {
  const key = scopeKey(scope, period);
  let hit = cache.get(key);
  if (!hit || now.getTime() - hit.at > RANKING_CACHE_MS) {
    const rows =
      period === 'week'
        ? await source.topWeek(scope, weekId(now), RANKING_SIZE)
        : await source.top(scope, activeSince(now), RANKING_SIZE);
    hit = { at: now.getTime(), rows };
    cache.set(key, hit);
  }
  return hit.rows.map((r, i) => ({
    pos: i + 1,
    name: r.publicName,
    tag: r.tag,
    points: Math.round(period === 'week' ? (r.weekPoints ?? 0) : r.rating),
    rating: Math.round(r.rating),
    division: divisionFor(r.rating, r.games),
    you: r.id === youId,
  }));
}

/** Nombre público: el nombre en la mesa, 1–20 caracteres, sin palabrotas (S4-08). */
export function cleanPublicName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, 20);
  return s.length > 0 && !isOffensiveName(s) ? s : null;
}

export function newTag(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}
