/**
 * S4-03: municipios del INE (cargados una vez de `data/municipios.json`)
 * y "de dónde eres" del jugador, con un cambio como mucho cada 30 días.
 */
import { readFileSync } from 'node:fs';
import { PLACE_CHANGE_DAYS, provinceName } from '@guinote/protocol';

/** [código INE de 5 cifras, nombre, nombre alternativo (bilingüe)?] */
export type MunicipioRow = [string, string] | [string, string, string];

let cache: Record<string, MunicipioRow[]> | null = null;

function data(): Record<string, MunicipioRow[]> {
  if (!cache) {
    // src/places.ts o dist/places.js → ../data/municipios.json
    cache = JSON.parse(readFileSync(new URL('../data/municipios.json', import.meta.url), 'utf8')) as Record<string, MunicipioRow[]>;
  }
  return cache;
}

export function municipiosOf(province: string): MunicipioRow[] | null {
  if (!provinceName(province)) return null;
  return data()[province] ?? [];
}

export function municipioName(code: string): string | null {
  const row = data()[code.slice(0, 2)]?.find((r) => r[0] === code);
  return row ? row[1] : null;
}

export interface Place {
  province: string;
  municipio: string | null;
}

export interface PlaceView {
  province: string | null;
  provinceName: string | null;
  municipio: string | null;
  municipioName: string | null;
  /** ISO: desde cuándo se puede volver a cambiar (null = ya se puede). */
  nextChangeAt: string | null;
}

export function viewPlace(place: Place | null | undefined, changedAt: string | null | undefined, now: Date = new Date()): PlaceView {
  const next = changedAt ? new Date(Date.parse(changedAt) + PLACE_CHANGE_DAYS * 86_400_000) : null;
  return {
    province: place?.province ?? null,
    provinceName: place ? provinceName(place.province) : null,
    municipio: place?.municipio ?? null,
    municipioName: place?.municipio ? municipioName(place.municipio) : null,
    nextChangeAt: next && next > now ? next.toISOString() : null,
  };
}

export type PlaceCheck = { ok: true; place: Place | null } | { ok: false; error: string };

/**
 * Valida un cambio. `null` = no decirlo. La primera vez (sin lugar ni
 * cambio previo) siempre se puede; después, una vez cada 30 días.
 */
export function checkPlaceChange(
  body: { province?: unknown; municipio?: unknown },
  changedAt: string | null | undefined,
  now: Date = new Date(),
): PlaceCheck {
  if (changedAt && Date.parse(changedAt) + PLACE_CHANGE_DAYS * 86_400_000 > now.getTime()) {
    return { ok: false, error: `Solo se puede cambiar una vez cada ${PLACE_CHANGE_DAYS} días` };
  }
  if (body.province === null || body.province === undefined || body.province === '') return { ok: true, place: null };
  if (typeof body.province !== 'string' || !provinceName(body.province)) return { ok: false, error: 'Provincia no válida' };
  const mun = body.municipio;
  if (mun === null || mun === undefined || mun === '') return { ok: true, place: { province: body.province, municipio: null } };
  if (typeof mun !== 'string' || mun.slice(0, 2) !== body.province || !municipioName(mun)) {
    return { ok: false, error: 'Ese pueblo no es de esa provincia' };
  }
  return { ok: true, place: { province: body.province, municipio: mun } };
}
