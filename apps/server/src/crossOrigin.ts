/**
 * S6-02: la web y la API en orígenes distintos.
 *
 * Con la web en Static Web Apps (`https://www.guinoteonline.es`) y la API en la
 * Container App (`https://api.guinoteonline.es`):
 *  - `ALLOWED_ORIGINS`: lista separada por comas de orígenes que pueden
 *    llamar a la API con cookies (CORS con credenciales) y abrir WebSockets.
 *    Vacía = como hasta ahora (CORS sin credenciales; en desarrollo Vite hace
 *    de proxy y todo es mismo origen).
 *  - `COOKIE_DOMAIN` (p. ej. `.guinoteonline.es`): las cookies de sesión y de
 *    jugador valen para el dominio y todos sus subdominios. Solo se pone si
 *    la petición llega por ese dominio (si no, el navegador la rechazaría).
 *  - `SERVE_WEB=false`: el contenedor deja de servir la web.
 */

export interface CrossOriginConfig {
  allowedOrigins: string[];
  cookieDomain: string | null;
  serveWeb: boolean;
}

function normOrigin(o: string): string {
  return o.trim().toLowerCase().replace(/\/+$/, '');
}

export function readCrossOriginConfig(env: NodeJS.ProcessEnv = process.env): CrossOriginConfig {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(normOrigin)
    .filter((o) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(o));
  const rawDomain = (env.COOKIE_DOMAIN ?? '').trim().toLowerCase();
  const cookieDomain = /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(rawDomain)
    ? rawDomain.startsWith('.') ? rawDomain : `.${rawDomain}`
    : null;
  const serveWeb = (env.SERVE_WEB ?? 'true').trim().toLowerCase() !== 'false';
  return { allowedOrigins, cookieDomain, serveWeb };
}

/** Host de la petición sin puerto (respeta `X-Forwarded-Host`). */
export function requestHost(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['x-forwarded-host'] ?? headers.host ?? '';
  const host = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  return host.split(',')[0]!.trim().split(':')[0]!.toLowerCase();
}

/**
 * ¿Se acepta este `Origin`? Sin cabecera (apps, curl, mismo origen en GET)
 * o sin lista configurada → sí. Si no, tiene que estar en la lista o ser
 * el propio host de la petición (la web servida por el mismo contenedor).
 */
export function originAllowed(origin: string | undefined, cfg: CrossOriginConfig, host: string): boolean {
  if (!origin) return true;
  if (cfg.allowedOrigins.length === 0) return true;
  const o = normOrigin(origin);
  if (cfg.allowedOrigins.includes(o)) return true;
  try {
    return new URL(o).hostname === host && host !== '';
  } catch {
    return false;
  }
}

/** `Domain=` que toca para esta petición, o null (cookie solo del host). */
export function cookieDomainFor(host: string, cfg: CrossOriginConfig): string | null {
  const d = cfg.cookieDomain;
  if (!d || !host) return null;
  return host === d.slice(1) || host.endsWith(d) ? d : null;
}

let current: CrossOriginConfig | null = null;
/** Configuración en uso (se lee del entorno la primera vez; los tests la cambian). */
export function crossOrigin(): CrossOriginConfig {
  return (current ??= readCrossOriginConfig());
}
export function setCrossOriginConfig(cfg: CrossOriginConfig): void {
  current = cfg;
}
