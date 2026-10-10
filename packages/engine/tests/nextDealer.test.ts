import { describe, it, expect } from 'vitest';
import { nextDealer } from '../src/rules.js';

/**
 * Regla del guiñote aragonés ("el que corta, reparte"): el dealer de la
 * siguiente mano es el ganador de la última baza de la mano anterior.
 * Aplica a TODAS las transiciones (incluida vuelta 1 → vuelta 2) — no hay
 * rotación.
 */
describe('nextDealer ("el que corta, reparte")', () => {
  it('el dealer de la siguiente mano es el ganador de la última baza', () => {
    expect(nextDealer(0, 1)).toBe(0);
    expect(nextDealer(1, 0)).toBe(1);
    expect(nextDealer(2, 3)).toBe(2);
    expect(nextDealer(3, 2)).toBe(3);
  });

  it('no rota: si el último ganador es distinto al dealer actual, gana el último ganador (no dealer+1)', () => {
    // Verificación contra el bug anterior (rotación +1). Caso diseñado para
    // que la regla correcta (último ganador) y la antigua (dealer+1) den
    // asientos DISTINTOS.
    const lastWinner = 0;
    const currentDealer = 1; // dealer del ida, NO coincide con el ganador de la última
    expect(nextDealer(lastWinner, currentDealer)).toBe(lastWinner);
    expect(nextDealer(lastWinner, currentDealer)).not.toBe((currentDealer + 1) % 4);
    expect(nextDealer(lastWinner, currentDealer)).toBe(0);
  });

  it('aplica igual a la transición idas → vueltas', () => {
    // El comportamiento no distingue entre vuelta 1 → 2 y vuelta N → N+1:
    // siempre devuelve el ganador de la última baza.
    expect(nextDealer(2, 3)).toBe(2); // vuelta 1 → 2
    expect(nextDealer(2, 3)).toBe(2); // vuelta 2 → 3 (mismo seat ficticio)
  });

  it('si no hay ganador (no debería pasar) cae al dealer actual como fallback', () => {
    expect(nextDealer(null, 0)).toBe(0);
    expect(nextDealer(null, 3)).toBe(3);
  });
});
