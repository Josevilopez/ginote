/**
 * S6-01: dónde está la API. La web puede servirse desde Static Web Apps
 * (`www.guinoteonline.es`) y la API desde la Container App
 * (`api.guinoteonline.es`). Con `VITE_API_ORIGIN` vacío (desarrollo, o la
 * web servida por el propio contenedor) todo va al mismo origen.
 */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/+$/, '');

/** `/api/...` → URL completa de la API. Otras URLs se dejan como están. */
export function apiUrl(path: string): string {
  return API_ORIGIN && path.startsWith('/') ? `${API_ORIGIN}${path}` : path;
}

/** `/ws/...` → `wss://api…/ws/...` (o el mismo host si la API va junto a la web). */
export function wsUrl(path: string): string {
  if (API_ORIGIN) return `${API_ORIGIN.replace(/^http/, 'ws')}${path}`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${path}`;
}

/**
 * `fetch` para la API: URL completa y siempre con cookies (la sesión vive
 * en `.guinoteonline.es`, compartida por la web y `api.`).
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(input), { ...init, credentials: 'include' });
}
