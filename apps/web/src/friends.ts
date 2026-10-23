/**
 * S5-01: amigos en el cliente. Con sesión, se pregunta `/api/friends`
 * cada 15 s (eso también te marca como "conectado" para los demás) y se
 * muestran las invitaciones que lleguen.
 */
import { create } from 'zustand';
import type { Division } from '@guinote/protocol';
import { apiFetch } from './api.js';

export type FriendStatus = 'online' | 'playing' | 'offline';

export interface Friend {
  id: string;
  name: string;
  tag: string | null;
  division: Division | null;
  status: FriendStatus;
}

export interface Invite {
  id: string;
  fromId: string;
  fromName: string;
  kind: 'pareja' | 'mesa';
  code: string;
  expiresInMs: number;
}

export interface FriendsData {
  me: { name: string; tag: string | null };
  friends: Friend[];
  /** S5-03: los de tu peña que no son amigos (también se les puede invitar a jugar). */
  mates?: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
  invites: Invite[];
}

interface FriendsState {
  data: FriendsData | null;
  /** Invitaciones a las que ya has dicho "Ahora no" (por si el aviso tarda en irse). */
  dismissed: string[];
  refresh: () => Promise<void>;
  /** Devuelve un mensaje para mostrar (éxito o error). */
  request: (code: string) => Promise<{ ok: boolean; message: string }>;
  accept: (id: string) => Promise<void>;
  /** Rechazar solicitud, cancelar la tuya o quitar amigo. */
  remove: (id: string, how: 'reject' | 'delete') => Promise<void>;
  invite: (id: string, kind: 'pareja' | 'mesa', code: string) => Promise<string | null>;
  dismiss: (inviteId: string) => Promise<void>;
  clear: () => void;
}

const json = { 'Content-Type': 'application/json' };

async function errorOf(r: Response, fallback: string): Promise<string> {
  try {
    const b = (await r.json()) as { error?: string };
    return b.error ?? fallback;
  } catch {
    return fallback;
  }
}

export const useFriends = create<FriendsState>((set, get) => ({
  data: null,
  dismissed: [],

  async refresh() {
    try {
      const r = await apiFetch('/api/friends', { credentials: 'same-origin' });
      if (r.status === 401) return set({ data: null });
      if (!r.ok) return;
      const data = (await r.json()) as FriendsData;
      const live = new Set(data.invites.map((i) => i.id));
      set({ data, dismissed: get().dismissed.filter((id) => live.has(id)) });
    } catch {
      // Sin red: nos quedamos con lo que había.
    }
  },

  async request(code) {
    try {
      const r = await apiFetch('/api/friends/request', { method: 'POST', credentials: 'same-origin', headers: json, body: JSON.stringify({ code }) });
      if (!r.ok) return { ok: false, message: await errorOf(r, 'No se pudo enviar. Inténtalo otra vez.') };
      const { status } = (await r.json()) as { status: 'sent' | 'friends' | 'already-friends' | 'already-sent' };
      await get().refresh();
      const message =
        status === 'friends'
          ? '¡Ya sois amigos!'
          : status === 'already-friends'
            ? 'Ya sois amigos.'
            : status === 'already-sent'
              ? 'Ya se la habías enviado. Falta que acepte.'
              : 'Solicitud enviada. Cuando acepte, aparecerá en tu lista.';
      return { ok: true, message };
    } catch {
      return { ok: false, message: 'Sin conexión. Inténtalo otra vez.' };
    }
  },

  async accept(id) {
    await apiFetch(`/api/friends/${encodeURIComponent(id)}/accept`, { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    await get().refresh();
  },

  async remove(id, how) {
    const url = `/api/friends/${encodeURIComponent(id)}${how === 'reject' ? '/reject' : ''}`;
    await apiFetch(url, { method: how === 'reject' ? 'POST' : 'DELETE', credentials: 'same-origin' }).catch(() => null);
    await get().refresh();
  },

  async invite(id, kind, code) {
    try {
      const r = await apiFetch(`/api/friends/${encodeURIComponent(id)}/invite`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: json,
        body: JSON.stringify({ kind, code }),
      });
      return r.ok ? null : await errorOf(r, 'No se pudo invitar.');
    } catch {
      return 'Sin conexión.';
    }
  },

  async dismiss(inviteId) {
    set({ dismissed: [...get().dismissed, inviteId] });
    await apiFetch(`/api/invites/${encodeURIComponent(inviteId)}/dismiss`, { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  },

  clear() {
    set({ data: null, dismissed: [] });
  },
}));

export const FRIENDS_POLL_MS = 15_000;

export function friendCode(me: { name: string; tag: string | null }): string {
  return me.tag ? `${me.name}#${me.tag}` : me.name;
}

/** Enlace para que te añadan: `https://host/#amigos/Josevi%234821`. */
export function friendLink(code: string): string {
  return `${window.location.origin}/#amigos/${encodeURIComponent(code)}`;
}

/** `#amigos` o `#amigos/<código>` → { code } (código a añadir, si viene). */
export function friendsRoute(hash: string = window.location.hash): { code: string | null } | null {
  if (hash === '#amigos') return { code: null };
  const m = /^#amigos\/(.+)$/.exec(hash);
  if (!m) return null;
  try {
    return { code: decodeURIComponent(m[1]!) };
  } catch {
    return { code: null };
  }
}

export const STATUS_LABEL: Record<FriendStatus, string> = {
  online: 'Conectado',
  playing: 'Jugando',
  offline: 'Desconectado',
};
