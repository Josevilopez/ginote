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

let playerReady: Promise<void> | null = null;
/**
 * Se asegura de que este navegador tiene identidad de jugador (cookie
 * `guinote_pid` y su ficha en el servidor) antes de buscar partida, formar
 * pareja o sentarse en una mesa. Con cuenta no hace nada nuevo. Una sola
 * llamada por carga de página; si falla, se reintenta la próxima vez.
 */
export function ensurePlayerId(): Promise<void> {
  return (playerReady ??= apiFetch('/api/player', { method: 'POST' }).then(
    (r) => {
      if (!r.ok) playerReady = null;
    },
    () => {
      playerReady = null;
    },
  ));
}
