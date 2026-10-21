/**
 * S3-01: cuenta opcional con Google.
 *
 * El servidor guarda la sesión en una cookie httpOnly; aquí solo
 * mantenemos lo que pinta la portada (quién eres) y las acciones
 * (entrar, salir, descargar datos, borrar cuenta).
 */
import { create } from 'zustand';
import { forgetPushOnThisDevice } from './push.js';
import { getPlayerName } from './store.js';

export interface Me {
  name: string | null;
  email: string | null;
  /** Fecha de alta (ISO). Solo viene de `/api/me`. */
  since?: string;
}

/** S4-09: temporada actual e insignias de las pasadas. */
export interface SeasonView {
  id: string;
  name: string;
  ends: string;
  badges: { season: string; name: string; division: 'bronce' | 'plata' | 'oro' | 'maestro' | 'leyenda' }[];
}

/** S4-03: de dónde eres (como lo devuelve el servidor). */
export interface PlaceView {
  province: string | null;
  provinceName: string | null;
  municipio: string | null;
  municipioName: string | null;
  nextChangeAt: string | null;
}

interface AccountState {
  /** `loading` hasta saber si hay login configurado y si hay sesión. */
  status: 'loading' | 'ready';
  googleClientId: string | null;
  me: Me | null;
  stats: {
    games: number;
    wins: number;
    losses: number;
    streak?: number;
    bestStreak?: number;
    rating?: number;
    /** S4-04: nombre público (ranking) y etiqueta. */
    publicName?: string | null;
    tag?: string | null;
  } | null;
  error: string | null;
  /** S4-03. */
  place: PlaceView | null;
  /** S4-09. */
  season: SeasonView | null;
  /** S5-05: torneos ganados. */
  trophies: { torneoId: string; name: string; at: string }[];
  savePlace: (province: string | null, municipio: string | null) => Promise<boolean>;
  /** S4-04: guarda tu nombre en la mesa en la cuenta (es tu nombre en el ranking). */
  saveName: (name: string) => Promise<void>;
  init: () => Promise<void>;
  /** Vuelve a pedir `/api/me` (p. ej. al abrir el perfil tras jugar). */
  refresh: () => Promise<void>;
  /** Recibe el ID token de Google. Devuelve el nombre de pila, si viene. */
  login: (credential: string) => Promise<string | null>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
}

let initStarted = false;

export const useAccount = create<AccountState>((set, get) => ({
  status: 'loading',
  googleClientId: null,
  me: null,
  stats: null,
  error: null,
  place: null,
  season: null,
  trophies: [],

  async init() {
    if (initStarted) return;
    initStarted = true;
    try {
      const [config, me] = await Promise.all([
        fetch('/api/config').then((r) => (r.ok ? r.json() : { googleClientId: null })) as Promise<{ googleClientId: string | null }>,
        fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { user: null })) as Promise<{
          user: Me | null;
          player?: AccountState['stats'];
          place?: PlaceView;
          season?: SeasonView;
          trophies?: AccountState['trophies'];
        }>,
      ]);
      set({ status: 'ready', googleClientId: config.googleClientId, me: me.user, stats: me.player ?? null, place: me.place ?? null, season: me.season ?? null, trophies: me.trophies ?? [] });
      ensurePublicName();
    } catch {
      // Servidor viejo o sin red: la portada funciona igual, sin login.
      set({ status: 'ready' });
    }
  },

  async refresh() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (!r.ok) return;
      const m = (await r.json()) as { user: Me | null; player?: AccountState['stats']; place?: PlaceView; season?: SeasonView; trophies?: AccountState['trophies'] };
      set({ me: m.user, stats: m.player ?? null, place: m.place ?? null, season: m.season ?? null, trophies: m.trophies ?? [] });
      ensurePublicName();
    } catch {
      // Sin red: nos quedamos con lo que había.
    }
  },

  async saveName(name) {
    if (!get().me) return;
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!clean || clean === get().stats?.publicName) return;
    try {
      const r = await fetch('/api/me/name', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      });
      if (!r.ok) return;
      const b = (await r.json()) as { publicName: string; tag: string };
      const stats = get().stats;
      if (stats) set({ stats: { ...stats, publicName: b.publicName, tag: b.tag } });
    } catch {
      // Se reintentará la próxima vez que cambies el nombre o entres.
    }
  },

  async savePlace(province, municipio) {
    set({ error: null });
    try {
      const r = await fetch('/api/me/place', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ province, municipio }),
      });
      const body = (await r.json()) as { place?: PlaceView; error?: string };
      if (body.place) set({ place: body.place });
      if (!r.ok) {
        set({ error: body.error ?? 'No se pudo guardar' });
        return false;
      }
      return true;
    } catch {
      set({ error: 'No se pudo guardar. ¿Hay conexión?' });
      return false;
    }
  },

  async login(credential) {
    set({ error: null });
    try {
      const r = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { user: Me; givenName: string | null };
      set({ me: body.user });
      // Fecha de alta y partidas del player de la cuenta (puede venir de
      // otro dispositivo).
      void useAccount.getState().refresh();
      return body.givenName;
    } catch {
      set({ error: 'No se pudo entrar con Google. Inténtalo otra vez.' });
      return null;
    }
  },

  async logout() {
    // S5-02: en un dispositivo compartido, que no le lleguen tus avisos al siguiente.
    await forgetPushOnThisDevice();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    window.google?.accounts.id.disableAutoSelect();
    set({ me: null, stats: null, place: null });
  },

  async deleteAccount() {
    await forgetPushOnThisDevice();
    const r = await fetch('/api/me', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
    if (!r || !r.ok) {
      set({ error: 'No se pudo borrar la cuenta. Inténtalo otra vez.' });
      return false;
    }
    window.google?.accounts.id.disableAutoSelect();
    set({ me: null, stats: null, place: null, error: null });
    return true;
  },
}));

// ───────────── Google Identity Services ─────────────

export interface GsiButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  locale?: string;
  width?: number;
  logo_alignment?: 'left' | 'center';
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (res: { credential: string }) => void;
            auto_select?: boolean;
            ux_mode?: 'popup' | 'redirect';
            use_fedcm_for_prompt?: boolean;
          }) => void;
          renderButton: (el: HTMLElement, opts: GsiButtonOptions) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

let gsiPromise: Promise<void> | null = null;

/** Carga el script de Google una sola vez. */
export function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error('No se pudo cargar Google'));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

// ───────────── Botón de Google (en uno o varios sitios) ─────────────

let gsiReady = false;
const givenNameListeners = new Set<(name: string) => void>();

/** Aviso con el nombre de pila de Google al entrar (para el nombre en la mesa). */
export function onGoogleGivenName(cb: (name: string) => void): () => void {
  givenNameListeners.add(cb);
  return () => givenNameListeners.delete(cb);
}

/**
 * Pinta el botón de Google en `el`. Inicializa Google una sola vez (el
 * callback entra con la cuenta y avisa del nombre de pila).
 */
export async function renderGoogleButton(el: HTMLElement, clientId: string, opts: GsiButtonOptions): Promise<void> {
  await loadGoogleScript();
  const g = window.google;
  if (!g) throw new Error('Google no disponible');
  if (!gsiReady) {
    g.accounts.id.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      callback: (res) => {
        void useAccount
          .getState()
          .login(res.credential)
          .then((given) => {
            if (given) for (const l of givenNameListeners) l(given);
          });
      },
    });
    gsiReady = true;
  }
  el.innerHTML = '';
  g.accounts.id.renderButton(el, opts);
}

// ───────────── S4-01: historial ─────────────

export interface ResultRow {
  at: string;
  kind: 'online' | 'pareja';
  won: boolean;
  abandoned: boolean;
  /** Puntos de nivel ganados (+) o perdidos (−). */
  delta: number;
  mate: { name: string; bot: boolean } | null;
  rivals: { name: string; bot: boolean }[];
}

export async function fetchMyResults(): Promise<ResultRow[] | null> {
  try {
    const r = await fetch('/api/me/results', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return ((await r.json()) as { results: ResultRow[] }).results;
  } catch {
    return null;
  }
}

/** S4-03: municipios de una provincia: [código, nombre, nombre bilingüe?]. */
export type MunicipioRow = [string, string] | [string, string, string];
const municipiosCache = new Map<string, Promise<MunicipioRow[]>>();
export function fetchMunicipios(province: string): Promise<MunicipioRow[]> {
  let p = municipiosCache.get(province);
  if (!p) {
    p = fetch(`/api/places/${province}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ municipios: MunicipioRow[] }>) : { municipios: [] }))
      .then((b) => b.municipios);
    p.catch(() => municipiosCache.delete(province));
    municipiosCache.set(province, p);
  }
  return p;
}

/**
 * S4-04: si la cuenta aún no tiene nombre público, se le pone el nombre en
 * la mesa de este dispositivo (o el nombre de pila de Google).
 */
function ensurePublicName(): void {
  const { me, stats, saveName } = useAccount.getState();
  if (!me || !stats || stats.publicName) return;
  const local = getPlayerName();
  const name = local && local !== 'Jugador' ? local : (me.name?.trim().split(/\s+/)[0] ?? '');
  if (name) void saveName(name);
}
