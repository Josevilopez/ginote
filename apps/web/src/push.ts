/**
 * S5-02: avisos push en el cliente.
 *
 * El service worker (`/sw.js`) solo se registra cuando la persona activa
 * los avisos (o si ya los tenía activados). El permiso del navegador se
 * pide únicamente al pulsar "Sí, avisadme": si se rechaza, el navegador ya
 * no deja volver a preguntar.
 */
import { create } from 'zustand';

export type PushStatus =
  | 'loading'
  /** Navegador sin soporte. */
  | 'unsupported'
  /** iPhone/iPad sin añadir a la pantalla de inicio: hay que hacerlo primero. */
  | 'ios-install'
  /** El servidor no tiene claves VAPID. */
  | 'server-off'
  /** La persona bloqueó los avisos en el navegador. */
  | 'denied'
  | 'off'
  | 'on';

export interface PushPrefs {
  invite: boolean;
  request: boolean;
  /** S5-04 (servidores viejos no lo mandan). */
  reto?: boolean;
  /** S5-05 */
  torneo?: boolean;
}

interface PushState {
  status: PushStatus;
  prefs: PushPrefs | null;
  busy: boolean;
  error: string | null;
  check: () => Promise<void>;
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
  loadPrefs: () => Promise<void>;
  savePrefs: (p: Partial<PushPrefs>) => Promise<void>;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let publicKey: string | null | undefined;
async function serverKey(): Promise<string | null> {
  if (publicKey !== undefined) return publicKey;
  try {
    const r = await fetch('/api/push/config');
    publicKey = r.ok ? ((await r.json()) as { publicKey: string | null }).publicKey : null;
  } catch {
    return null; // sin red: se reintenta la próxima vez
  }
  return publicKey;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function sendToServer(sub: PushSubscription): Promise<boolean> {
  const r = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  }).catch(() => null);
  return !!r?.ok;
}

let syncedThisSession = false;

export const usePush = create<PushState>((set, get) => ({
  status: 'loading',
  prefs: null,
  busy: false,
  error: null,

  async check() {
    if (!supported()) return set({ status: isIOS() && !isStandalone() ? 'ios-install' : 'unsupported' });
    const key = await serverKey();
    if (!key) return set({ status: 'server-off' });
    if (Notification.permission === 'denied') return set({ status: 'denied' });
    const sub = Notification.permission === 'granted' ? await currentSubscription().catch(() => null) : null;
    if (sub && !syncedThisSession) {
      // Por si cambió de cuenta en este navegador o el servidor la olvidó.
      syncedThisSession = true;
      void sendToServer(sub);
    }
    set({ status: sub ? 'on' : 'off' });
  },

  async enable() {
    const key = await serverKey();
    if (!supported() || !key) return false;
    set({ busy: true, error: null });
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        set({ status: perm === 'denied' ? 'denied' : 'off' });
        return false;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
      if (!(await sendToServer(sub))) {
        set({ error: 'No se pudieron activar los avisos. Inténtalo más tarde.' });
        return false;
      }
      syncedThisSession = true;
      set({ status: 'on' });
      return true;
    } catch {
      set({ error: 'Este navegador no ha dejado activar los avisos.' });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async disable() {
    set({ busy: true, error: null });
    await forgetPushOnThisDevice();
    set({ busy: false, status: 'off' });
  },

  async loadPrefs() {
    const r = await fetch('/api/push/prefs', { credentials: 'same-origin' }).catch(() => null);
    if (r?.ok) set({ prefs: (await r.json()) as PushPrefs });
  },

  async savePrefs(p) {
    const prev = get().prefs;
    if (prev) set({ prefs: { ...prev, ...p } });
    const r = await fetch('/api/push/prefs', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).catch(() => null);
    if (r?.ok) set({ prefs: (await r.json()) as PushPrefs });
    else set({ prefs: prev, error: 'No se pudo guardar. Inténtalo otra vez.' });
  },
}));

/** Quita los avisos de este dispositivo (al desactivarlos o al cerrar sesión). */
export async function forgetPushOnThisDevice(): Promise<void> {
  if (!supported()) return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // Nada que hacer: como mucho, el servidor la borrará cuando caduque.
  }
}

/**
 * Al tocar un aviso con la web ya abierta, el service worker nos pasa la
 * URL en vez de abrir otra pestaña. `#ABCD` = mesa; el resto, cambio de hash.
 */
export function listenForPushClicks(joinRoom: (code: string) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;
  const onMsg = (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null;
    if (d?.type !== 'guinote:open' || typeof d.url !== 'string') return;
    const hash = new URL(d.url, window.location.origin).hash;
    const room = /^#([A-Za-z0-9]{4})$/.exec(hash);
    if (room) joinRoom(room[1]!.toUpperCase());
    else if (hash) window.location.hash = hash;
  };
  navigator.serviceWorker.addEventListener('message', onMsg);
  return () => navigator.serviceWorker.removeEventListener('message', onMsg);
}

const PROMPT_KEY = 'guinote:push-prompt';
export function promptDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === 'no';
  } catch {
    return false;
  }
}
export function dismissPrompt(): void {
  try {
    localStorage.setItem(PROMPT_KEY, 'no');
  } catch {
    // Sin almacenamiento: volverá a salir, no pasa nada.
  }
}
