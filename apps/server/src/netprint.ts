/**
 * S4-08: huella anónima de una conexión. HMAC-SHA256 de la IP con una sal
 * aleatoria de este proceso, recortado: permite comparar "¿es la misma
 * conexión?" dentro de una partida sin guardar la IP (ni poder recuperarla).
 */
import { createHmac, randomBytes } from 'node:crypto';

const salt = randomBytes(32);

export function netFingerprint(ip: string): string {
  return createHmac('sha256', salt).update(ip).digest('base64url').slice(0, 16);
}
