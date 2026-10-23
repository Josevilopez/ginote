/**
 * S3-01: sesión de usuario con cuenta.
 *
 * Cookie `guinote_sid` httpOnly, firmada con HMAC-SHA256
 * (`SESSION_SECRET`). Lleva el `userId` y el `playerId` principal de la
 * cuenta, así el WS y `POST /api/rooms` saben quién eres sin leer Cosmos.
 *
 * Formato: `<payload base64url>.<firma base64url>`, payload
 * `{ uid, pid, exp }` con `exp` en segundos epoch.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'guinote_sid';
/** 180 días. */
export const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;

export interface Session {
  /** Id de la cuenta (`g_<sub de Google>`). */
  uid: string;
  /** Player principal de la cuenta (rating, partidas). */
  pid: string;
  /** Caducidad en segundos epoch. */
  exp: number;
}

let secret: Buffer | null = null;

/**
 * Lee `SESSION_SECRET`. Devuelve si las sesiones se pueden usar:
 *  - con secreto (≥32 caracteres): sí.
 *  - sin secreto en desarrollo: sí, con uno aleatorio (las sesiones se
 *    pierden al reiniciar) y un aviso.
 *  - sin secreto en producción: NO. El login queda desactivado (no
 *    tumbamos el servidor por eso) y se avisa en el log.
 */
export function initSessionSecret(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = console.warn): boolean {
  const raw = env.SESSION_SECRET;
  if (raw && raw.length >= 32) {
    secret = Buffer.from(raw, 'utf8');
    return true;
  }
  secret = randomBytes(32);
  if (env.NODE_ENV === 'production') {
    warn('[auth] SESSION_SECRET no definido (o con menos de 32 caracteres): login con Google DESACTIVADO');
    return false;
  }
  warn('[auth] SESSION_SECRET no definido: uso uno aleatorio (las sesiones se pierden al reiniciar)');
  return true;
}

function key(): Buffer {
  if (!secret) initSessionSecret();
  return secret!;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(data: string): string {
  return b64url(createHmac('sha256', key()).update(data).digest());
}

export function encodeSession(s: Session): string {
  const payload = b64url(Buffer.from(JSON.stringify(s), 'utf8'));
  return `${payload}.${sign(payload)}`;
}

/** Devuelve la sesión si la firma es buena y no ha caducado; si no, null. */
export function decodeSession(value: string | null | undefined, nowS: number = Math.floor(Date.now() / 1000)): Session | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Session>;
    if (typeof s.uid !== 'string' || typeof s.pid !== 'string' || typeof s.exp !== 'number') return null;
    if (s.exp <= nowS) return null;
    return { uid: s.uid, pid: s.pid, exp: s.exp };
  } catch {
    return null;
  }
}

export function newSession(uid: string, pid: string, nowS: number = Math.floor(Date.now() / 1000)): Session {
  return { uid, pid, exp: nowS + SESSION_MAX_AGE_S };
}

/** Lee una cookie por nombre del header `Cookie`. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Valor para `Set-Cookie`. `maxAge` 0 borra la cookie (con el mismo `domain` con que se puso). */
export function cookieString(name: string, value: string, maxAgeS: number, secure: boolean, domain: string | null = null): string {
  const flags = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeS}`];
  // S6-02: con `Domain=.guinoteonline.es` la cookie vale también en `api.`.
  if (domain) flags.push(`Domain=${domain}`);
  if (secure) flags.push('Secure');
  return flags.join('; ');
}
