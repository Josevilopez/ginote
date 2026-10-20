/**
 * S4-06: semana de la clasificación semanal (lunes 00:00 → domingo 23:59,
 * hora de España). Identificador ISO, p. ej. "2026-W43".
 */
export const WEEK_MIN_GAMES = 3;

/** Fecha (año, mes, día) en Madrid de un instante. */
function madridDate(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Semana ISO (en hora de Madrid) del instante dado. */
export function weekId(at: Date = new Date()): string {
  const { y, m, d } = madridDate(at);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // lunes = 1 … domingo = 7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // jueves de esa semana
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
