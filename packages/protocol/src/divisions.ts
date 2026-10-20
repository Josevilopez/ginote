/**
 * S4-02: divisiones de nivel (confirmadas 2026-10-20).
 *
 *   Bronce < 900 · Plata 900–1049 · Oro 1050–1199 · Maestro 1200–1349 · Leyenda ≥ 1350
 *
 * Se empieza con 1000 (Plata). Hasta `PLACEMENT_GAMES` partidas con ELO
 * se está "sin clasificar". Compartido por servidor y web.
 */
export type Division = 'bronce' | 'plata' | 'oro' | 'maestro' | 'leyenda';

export const DIVISIONS: readonly { id: Division; name: string; min: number }[] = [
  { id: 'bronce', name: 'Bronce', min: -Infinity },
  { id: 'plata', name: 'Plata', min: 900 },
  { id: 'oro', name: 'Oro', min: 1050 },
  { id: 'maestro', name: 'Maestro', min: 1200 },
  { id: 'leyenda', name: 'Leyenda', min: 1350 },
];

/** Partidas con ELO necesarias para tener división. */
export const PLACEMENT_GAMES = 10;

export function divisionOfRating(rating: number): Division {
  let d: Division = 'bronce';
  for (const x of DIVISIONS) if (rating >= x.min) d = x.id;
  return d;
}

/** División, o null si aún no has jugado las partidas de clasificación. */
export function divisionFor(rating: number, games: number): Division | null {
  return games >= PLACEMENT_GAMES ? divisionOfRating(rating) : null;
}

export function divisionName(d: Division): string {
  return DIVISIONS.find((x) => x.id === d)!.name;
}

/** Siguiente división y los puntos que faltan, o null si ya eres Leyenda. */
export function nextDivision(rating: number): { division: Division; missing: number } | null {
  const i = DIVISIONS.findIndex((x) => x.id === divisionOfRating(rating));
  const next = DIVISIONS[i + 1];
  return next ? { division: next.id, missing: Math.ceil(next.min - rating) } : null;
}
