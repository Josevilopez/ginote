/**
 * S4-09: temporadas de 3 meses (hora de España).
 *   T1 invierno (ene–mar) · T2 primavera (abr–jun) · T3 verano (jul–sep) · T4 otoño (oct–dic)
 * Al cambiar de temporada, el nivel se acerca a 1000 a la mitad y queda una
 * insignia con la división más alta alcanzada.
 */
import { divisionOfRating, PLACEMENT_GAMES, type Division } from './divisions.js';

/** Cuánto se conserva de la distancia a 1000 al empezar temporada (0,5 = la mitad). */
export const SEASON_KEEP = 0.5;
export const SEASON_BASE = 1000;

const NAMES = ['Invierno', 'Primavera', 'Verano', 'Otoño'] as const;

function madridYearMonth(at: Date): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).formatToParts(at);
  return { y: Number(parts.find((p) => p.type === 'year')!.value), m: Number(parts.find((p) => p.type === 'month')!.value) };
}

/** "2026-T4". */
export function seasonId(at: Date = new Date()): string {
  const { y, m } = madridYearMonth(at);
  return `${y}-T${Math.floor((m - 1) / 3) + 1}`;
}

/** "Otoño 2026". */
export function seasonName(id: string): string {
  const [y, t] = id.split('-T');
  return `${NAMES[Number(t) - 1] ?? 'Temporada'} ${y}`;
}

/** Último día de la temporada, p. ej. "31 de diciembre". */
export function seasonEndLabel(id: string): string {
  const t = Number(id.split('-T')[1]);
  return ['31 de marzo', '30 de junio', '30 de septiembre', '31 de diciembre'][t - 1] ?? '';
}

export interface SeasonBadge {
  season: string;
  division: Division;
}

export interface SeasonFields {
  rating: number;
  games: number;
  seasonId?: string | undefined;
  seasonPeak?: number | undefined;
  seasonBadges?: SeasonBadge[] | undefined;
}

/**
 * Cambio de temporada perezoso. Devuelve los campos nuevos si hay que
 * aplicarlo, o null si el jugador ya está en la temporada actual.
 *  - Sin temporada (jugadores de antes): se le apunta la actual, sin reinicio.
 *  - De una temporada anterior: insignia (si estaba clasificado) con la
 *    división de su mejor nivel, y nivel a medio camino de 1000.
 */
export function rolloverSeason(
  doc: SeasonFields,
  now: Date = new Date(),
): { rating: number; seasonId: string; seasonPeak: number; seasonBadges: SeasonBadge[] } | null {
  const current = seasonId(now);
  if (doc.seasonId === current) return null;
  const badges = [...(doc.seasonBadges ?? [])];
  if (!doc.seasonId) {
    return { rating: doc.rating, seasonId: current, seasonPeak: Math.max(doc.seasonPeak ?? 0, doc.rating), seasonBadges: badges };
  }
  if (doc.games >= PLACEMENT_GAMES && !badges.some((b) => b.season === doc.seasonId)) {
    badges.push({ season: doc.seasonId, division: divisionOfRating(Math.max(doc.seasonPeak ?? doc.rating, doc.rating)) });
  }
  const rating = Math.round(SEASON_BASE + (doc.rating - SEASON_BASE) * SEASON_KEEP);
  return { rating, seasonId: current, seasonPeak: rating, seasonBadges: badges };
}
