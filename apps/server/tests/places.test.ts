import { describe, expect, it } from 'vitest';
import { PROVINCES, provinceName, searchKey } from '@guinote/protocol';
import { checkPlaceChange, municipioName, municipiosOf, viewPlace } from '../src/places.js';

/** S4-03 — de dónde eres: provincias y municipios del INE, un cambio al mes. */
describe('provincias y municipios', () => {
  it('52 provincias y 8.132 municipios', () => {
    expect(PROVINCES).toHaveLength(52);
    expect(new Set(PROVINCES.map((p) => p.code)).size).toBe(52);
    const total = PROVINCES.reduce((n, p) => n + (municipiosOf(p.code)?.length ?? 0), 0);
    expect(total).toBe(8132);
  });
  it('Aragón', () => {
    expect(municipiosOf('44')).toHaveLength(236);
    expect(municipioName('44013')).toBe('Alcañiz');
    expect(municipioName('50297')).toBe('Zaragoza');
    expect(provinceName('22')).toBe('Huesca');
    expect(municipiosOf('99')).toBeNull();
  });
  it('nombres bilingües para buscar', () => {
    expect(municipiosOf('46')!.find((r) => r[0] === '46220')).toEqual(['46220', 'Sagunt', 'Sagunto/Sagunt']);
    expect(searchKey(' Alcañiz ')).toBe('alcaniz');
  });
});

describe('cambiar de dónde eres', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('la primera vez, libre; luego una vez cada 30 días', () => {
    expect(checkPlaceChange({ province: '44', municipio: '44013' }, undefined, now)).toEqual({
      ok: true,
      place: { province: '44', municipio: '44013' },
    });
    expect(checkPlaceChange({ province: '50' }, '2026-10-01T12:00:00Z', now)).toMatchObject({ ok: false });
    expect(checkPlaceChange({ province: '50' }, '2026-09-19T12:00:00Z', now)).toEqual({ ok: true, place: { province: '50', municipio: null } });
  });
  it('validaciones', () => {
    expect(checkPlaceChange({ province: '99' }, undefined, now)).toEqual({ ok: false, error: 'Provincia no válida' });
    expect(checkPlaceChange({ province: '50', municipio: '44013' }, undefined, now)).toEqual({ ok: false, error: 'Ese pueblo no es de esa provincia' });
    expect(checkPlaceChange({ province: null }, undefined, now)).toEqual({ ok: true, place: null });
  });
  it('vista con nombres y cuándo se puede volver a cambiar', () => {
    expect(viewPlace({ province: '44', municipio: '44013' }, '2026-10-20T12:00:00Z', now)).toEqual({
      province: '44',
      provinceName: 'Teruel',
      municipio: '44013',
      municipioName: 'Alcañiz',
      nextChangeAt: '2026-11-19T12:00:00.000Z',
    });
    expect(viewPlace(null, undefined, now).nextChangeAt).toBeNull();
  });
});
