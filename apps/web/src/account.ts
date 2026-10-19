/**
 * S3-01: cuenta opcional con Google.
 *
 * El servidor guarda la sesión en una cookie httpOnly; aquí solo
 * mantenemos lo que pinta la portada (quién eres) y las acciones
 * (entrar, salir, descargar datos, borrar cuenta).
 */
import { create } from 'zustand';

export interface Me {
  name: string | null;
  email: string | null;
}

interface AccountState {
  /** `loading` hasta saber si hay login configurado y si hay sesión. */
  status: 'loading' | 'ready';
  googleClientId: string | null;
  me: Me | null;
  stats: { games: number; wins: number; losses: number } | null;
  error: string | null;
  init: () => Promise<void>;
  /** Recibe el ID token de Google. Devuelve el nombre de pila, si viene. */
  login: (credential: string) => Promise<string | null>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<boolean>;
}

let initStarted = false;

export const useAccount = create<AccountState>((set) => ({
  status: 'loading',
  googleClientId: null,
  me: null,
  stats: null,
  error: null,

  async init() {
    if (initStarted) return;
    initStarted = true;
    try {
      const [config, me] = await Promise.all([
        fetch('/api/config').then((r) => (r.ok ? r.json() : { googleClientId: null })) as Promise<{ googleClientId: string | null }>,
        fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { user: null })) as Promise<{
          user: Me | null;
          player?: AccountState['stats'];
        }>,
      ]);
      set({ status: 'ready', googleClientId: config.googleClientId, me: me.user, stats: me.player ?? null });
    } catch {
      // Servidor viejo o sin red: la portada funciona igual, sin login.
      set({ status: 'ready' });
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
      // Partidas del player de la cuenta (puede venir de otro dispositivo).
      void fetch('/api/me', { credentials: 'same-origin' })
        .then((res) => res.json() as Promise<{ player?: AccountState['stats'] }>)
        .then((m) => set({ stats: m.player ?? null }))
        .catch(() => undefined);
      return body.givenName;
    } catch {
      set({ error: 'No se pudo entrar con Google. Inténtalo otra vez.' });
      return null;
    }
  },

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    window.google?.accounts.id.disableAutoSelect();
    set({ me: null, stats: null });
  },

  async deleteAccount() {
    const r = await fetch('/api/me', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
    if (!r || !r.ok) {
      set({ error: 'No se pudo borrar la cuenta. Inténtalo otra vez.' });
      return false;
    }
    window.google?.accounts.id.disableAutoSelect();
    set({ me: null, stats: null, error: null });
    return true;
  },
}));

// ───────────── Google Identity Services ─────────────

interface GsiButtonOptions {
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
