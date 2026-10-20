import { describe, expect, it } from 'vitest';
import { weekId } from '@guinote/protocol';

/** S4-06 — semana de lunes a domingo en hora de España (ISO). */
describe('semana', () => {
  it('martes 20 oct 2026 → W43', () => {
    expect(weekId(new Date('2026-10-20T12:00:00Z'))).toBe('2026-W43');
  });
  it('el corte es el lunes a las 00:00 de Madrid (también el día del cambio de hora)', () => {
    // Domingo 25 oct, 23:30 en Madrid (ya en horario de invierno, UTC+1) = 22:30Z.
    expect(weekId(new Date('2026-10-25T22:30:00Z'))).toBe('2026-W43');
    // Lunes 26 oct, 00:30 en Madrid = domingo 23:30Z → ya es la semana siguiente.
    expect(weekId(new Date('2026-10-25T23:30:00Z'))).toBe('2026-W44');
  });
  it('fin de año: 2026 tiene 53 semanas', () => {
    expect(weekId(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(weekId(new Date('2027-01-04T12:00:00Z'))).toBe('2027-W01');
  });
});
