/**
 * S4-08: límites de peticiones (en memoria: hay una sola réplica).
 *
 * Ventana fija por grupo y clave (IP, o cuenta si hay sesión). Al pasarse
 * → 429 con `Retry-After`. Los límites son holgados: están para frenar
 * scripts y abusos, no a una familia jugando desde la misma wifi.
 */
import type { FastifyInstance } from 'fastify';
import { sessionOf } from './auth/routes.js';

export interface Rule {
  /** Nombre del grupo (para la clave y los logs). */
  group: string;
  match: (method: string, path: string) => boolean;
  limit: number;
  windowMs: number;
  /** `uid` usa la cuenta si hay sesión (si no, la IP). */
  key: 'ip' | 'uid';
}

const MIN = 60_000;

/** Reglas por orden: la primera que encaja manda (más el límite general de /api). */
export const RULES: Rule[] = [
  { group: 'login', match: (m, p) => m === 'POST' && p === '/api/auth/google', limit: 10, windowMs: MIN, key: 'ip' },
  { group: 'account', match: (m, p) => m !== 'GET' && p.startsWith('/api/me'), limit: 20, windowMs: MIN, key: 'uid' },
  { group: 'create', match: (m, p) => m === 'POST' && (p.startsWith('/api/rooms') || p === '/api/parties'), limit: 30, windowMs: MIN, key: 'ip' },
  { group: 'friends', match: (m, p) => m !== 'GET' && (p.startsWith('/api/friends') || p.startsWith('/api/invites')), limit: 30, windowMs: MIN, key: 'uid' },
  { group: 'push', match: (m, p) => m !== 'GET' && p.startsWith('/api/push'), limit: 20, windowMs: MIN, key: 'uid' },
  { group: 'penas', match: (m, p) => m !== 'GET' && p.startsWith('/api/penas'), limit: 20, windowMs: MIN, key: 'uid' },
  { group: 'ranking', match: (m, p) => p.startsWith('/api/ranking'), limit: 60, windowMs: MIN, key: 'ip' },
  { group: 'ws', match: (_m, p) => p.startsWith('/ws/'), limit: 60, windowMs: MIN, key: 'ip' },
];
/** Todo lo demás bajo /api (incluye preguntar por la pareja cada segundo). */
export const API_RULE: Rule = { group: 'api', match: (_m, p) => p.startsWith('/api/'), limit: 600, windowMs: MIN, key: 'ip' };

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly rules: Rule[] = RULES,
    private readonly general: Rule | null = API_RULE,
  ) {}

  /**
   * Cuenta una petición. Devuelve null si pasa, o los segundos a esperar.
   * `uid` = cuenta con sesión (o null).
   */
  hit(method: string, path: string, ip: string, uid: string | null, now: number = Date.now()): { group: string; retryAfterS: number } | null {
    const applicable = [this.rules.find((r) => r.match(method, path)), this.general?.match(method, path) ? this.general : undefined].filter(
      (r): r is Rule => !!r,
    );
    for (const r of applicable) {
      const key = `${r.group}:${r.key === 'uid' && uid ? `u:${uid}` : `ip:${ip}`}`;
      let e = this.hits.get(key);
      if (!e || e.resetAt <= now) {
        e = { count: 0, resetAt: now + r.windowMs };
        this.hits.set(key, e);
      }
      e.count++;
      if (e.count > r.limit) return { group: r.group, retryAfterS: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
    }
    return null;
  }

  /** Limpia ventanas caducadas (llamar de vez en cuando). */
  gc(now: number = Date.now()): void {
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }

  get size(): number {
    return this.hits.size;
  }
}


/** Engancha el limitador a todas las peticiones (también al abrir WebSockets). */
export function registerRateLimit(app: FastifyInstance, limiter: RateLimiter = new RateLimiter()): RateLimiter {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    const over = limiter.hit(req.method, path, req.ip, sessionOf(req)?.uid ?? null);
    if (over) {
      req.log.warn(`[antiabuso] límite ${over.group} superado ip=${req.ip}`);
      reply.header('Retry-After', String(over.retryAfterS));
      return reply.code(429).send({ error: 'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.' });
    }
  });
  const t = setInterval(() => limiter.gc(), 5 * MIN);
  t.unref();
  return limiter;
}
