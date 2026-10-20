import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { isOffensiveName } from '@guinote/protocol';
import { safeName } from '../src/names.js';
import { RateLimiter, registerRateLimit } from '../src/ratelimit.js';
import { createParty, joinParty, viewParty } from '../src/parties.js';

/** S4-08 — antiabuso básico: nombres, límites de peticiones. */
describe('nombres ofensivos', () => {
  it('bloquea lo obvio, también disimulado', () => {
    for (const n of ['puta', 'Hijo de puta', 'P0LLA', 'p.u.t.a', 'puuuuta', 'gilipoooollas', 'Cabrón', 'el cabron de mi primo', 'mierdas88', 'hitler', 'fuck you', 'Nazi']) {
      expect(isOffensiveName(n), n).toBe(true);
    }
  });
  it('no bloquea nombres normales que se parecen', () => {
    for (const n of ['Pola', 'Pollo', 'Apolonia', 'Culebra', 'Penélope', 'Mariquita', 'Yoshitaka', 'Scunthorpe', 'Pascuala', 'Chuse', 'Putxet', 'Sexto', 'Conchi', 'Josevi', 'María José']) {
      expect(isOffensiveName(n), n).toBe(false);
    }
  });
  it('safeName: ofensivo o vacío → "Jugador"', () => {
    expect(safeName('  Pilar  ')).toBe('Pilar');
    expect(safeName('puta')).toBe('Jugador');
    expect(safeName('')).toBe('Jugador');
    expect(safeName(42)).toBe('Jugador');
    expect(safeName('x'.repeat(40))).toHaveLength(20);
  });
  it('en la pareja tampoco pasan', () => {
    const { party, memberId } = createParty('gilipollas');
    joinParty(party.code, 'Pilar');
    expect(viewParty(party, memberId)!.members.map((m) => m.name)).toEqual(['Jugador', 'Pilar']);
  });
});

describe('límites de peticiones', () => {
  it('ventana fija por grupo e IP; se libera al pasar el minuto', () => {
    const rl = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) expect(rl.hit('POST', '/api/auth/google', '1.1.1.1', null, t)).toBeNull();
    expect(rl.hit('POST', '/api/auth/google', '1.1.1.1', null, t)).toEqual({ group: 'login', retryAfterS: 60 });
    // Otra IP, sin problema.
    expect(rl.hit('POST', '/api/auth/google', '2.2.2.2', null, t)).toBeNull();
    // Pasado el minuto, otra vez.
    expect(rl.hit('POST', '/api/auth/google', '1.1.1.1', null, t + 60_001)).toBeNull();
    rl.gc(t + 200_000);
    expect(rl.size).toBe(0);
  });
  it('escrituras de cuenta: por cuenta, no por IP (varios en la misma wifi)', () => {
    const rl = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(rl.hit('PUT', '/api/me/name', '1.1.1.1', 'g_ana', t)).toBeNull();
    expect(rl.hit('PUT', '/api/me/name', '1.1.1.1', 'g_ana', t)).not.toBeNull();
    expect(rl.hit('PUT', '/api/me/name', '1.1.1.1', 'g_bea', t)).toBeNull();
  });
  it('preguntar por la pareja cada segundo cabe de sobra en el límite general', () => {
    const rl = new RateLimiter();
    const t = 1_000_000;
    // 2 jugadores en la misma casa, 60 s cada uno.
    for (let i = 0; i < 120; i++) expect(rl.hit('GET', '/api/parties/ABCD', '1.1.1.1', null, t)).toBeNull();
  });
  it('responde 429 con Retry-After', async () => {
    const app = Fastify();
    registerRateLimit(app, new RateLimiter([{ group: 'x', match: (_m, p) => p === '/api/x', limit: 2, windowMs: 60_000, key: 'ip' }], null));
    app.get('/api/x', async () => ({ ok: true }));
    expect((await app.inject({ url: '/api/x' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/x?a=1' })).statusCode).toBe(200);
    const r = await app.inject({ url: '/api/x' });
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.json().error).toContain('Demasiadas peticiones');
  });
});
