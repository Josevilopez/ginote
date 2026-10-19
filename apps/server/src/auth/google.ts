/**
 * S3-01: verificación del ID token de Google (Google Identity Services).
 *
 * El cliente recibe un JWT firmado por Google (RS256) y nos lo manda.
 * Comprobamos firma con las claves públicas de Google (JWKS, en caché
 * según `Cache-Control`), emisor, audiencia (nuestro Client ID) y
 * caducidad. Sin dependencias: `node:crypto` importa JWK directamente.
 * No hace falta el client secret para este flujo.
 */
import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export interface GoogleIdentity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  picture?: string;
}

export interface Jwk extends JsonWebKey {
  kid?: string;
}

/** Fuente de claves; inyectable para tests. */
export type KeySource = () => Promise<Jwk[]>;

let cache: { keys: Jwk[]; until: number } | null = null;

export const googleKeys: KeySource = async () => {
  const now = Date.now();
  if (cache && cache.until > now) return cache.keys;
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`JWKS de Google: HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
  cache = { keys: body.keys, until: now + (maxAge ? Number(maxAge) * 1000 : 3600_000) };
  return body.keys;
};

export class GoogleTokenError extends Error {}

function decodePart<T>(part: string | undefined): T {
  if (!part) throw new GoogleTokenError('token mal formado');
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    throw new GoogleTokenError('token mal formado');
  }
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  keys: KeySource = googleKeys,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<GoogleIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new GoogleTokenError('token mal formado');
  const header = decodePart<{ alg?: string; kid?: string }>(parts[0]);
  if (header.alg !== 'RS256') throw new GoogleTokenError('algoritmo no admitido');
  const jwk = (await keys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new GoogleTokenError('clave desconocida');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  const ok = verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'));
  if (!ok) throw new GoogleTokenError('firma inválida');

  const p = decodePart<Record<string, unknown>>(parts[1]);
  if (!ISSUERS.has(String(p.iss))) throw new GoogleTokenError('emisor inválido');
  if (p.aud !== clientId) throw new GoogleTokenError('audiencia inválida');
  // 60 s de margen por relojes desajustados.
  if (typeof p.exp !== 'number' || p.exp + 60 < nowS) throw new GoogleTokenError('token caducado');
  if (typeof p.sub !== 'string' || !p.sub) throw new GoogleTokenError('sin sub');

  const id: GoogleIdentity = { sub: p.sub };
  if (typeof p.email === 'string') id.email = p.email;
  if (typeof p.email_verified === 'boolean') id.emailVerified = p.email_verified;
  if (typeof p.name === 'string') id.name = p.name;
  if (typeof p.given_name === 'string') id.givenName = p.given_name;
  if (typeof p.picture === 'string') id.picture = p.picture;
  return id;
}
