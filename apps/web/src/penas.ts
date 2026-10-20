/**
 * S5-03: peñas en el cliente. Vive en `#pena`; el enlace para entrar en
 * una es `#pena-CODIGO` (6 caracteres).
 */
import { create } from 'zustand';
import type { Division } from '@guinote/protocol';
import type { FriendStatus } from './friends.js';

export interface PenaMember {
  id: string;
  name: string;
  tag: string | null;
  division: Division | null;
  status: FriendStatus;
  owner: boolean;
  you: boolean;
  rating: number;
  games: number;
  weekPoints: number;
  weekGames: number;
}

export interface PenaView {
  id: string;
  name: string;
  placeName: string | null;
  code: string;
  youAreOwner: boolean;
  members: PenaMember[];
}

export interface PenaInvite {
  id: string;
  name: string;
  placeName: string | null;
  members: number;
}

export interface PenaPreview {
  name: string;
  placeName: string | null;
  members: number;
  youAreIn: boolean;
}

interface PenaState {
  /** undefined = sin cargar; null en `pena` = no estás en ninguna. */
  data: { pena: PenaView | null; invites: PenaInvite[] } | undefined;
  error: string | null;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<boolean>;
  join: (code: string) => Promise<boolean>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  invite: (userId: string) => Promise<string | null>;
  kick: (userId: string) => Promise<void>;
  leave: () => Promise<void>;
  clearError: () => void;
}

type Mine = { pena: PenaView | null; invites: PenaInvite[] };

async function call(url: string, init: RequestInit = {}): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    });
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    if (!r.ok) return { ok: false, error: body?.error ?? 'Algo ha fallado. Inténtalo otra vez.' };
    return { ok: true, body };
  } catch {
    return { ok: false, error: 'Sin conexión. Inténtalo otra vez.' };
  }
}

export const usePena = create<PenaState>((set) => {
  const apply = (r: Awaited<ReturnType<typeof call>>): boolean => {
    if (r.ok) set({ data: r.body as Mine, error: null });
    else set({ error: r.error });
    return r.ok;
  };
  return {
    data: undefined,
    error: null,
    async refresh() {
      const r = await call('/api/penas/mine');
      if (r.ok) set({ data: r.body as Mine });
    },
    async create(name) {
      return apply(await call('/api/penas', { method: 'POST', body: JSON.stringify({ name }) }));
    },
    async join(code) {
      return apply(await call(`/api/penas/join/${encodeURIComponent(code)}`, { method: 'POST' }));
    },
    async accept(id) {
      apply(await call(`/api/penas/invites/${encodeURIComponent(id)}/accept`, { method: 'POST' }));
    },
    async decline(id) {
      apply(await call(`/api/penas/invites/${encodeURIComponent(id)}/decline`, { method: 'POST' }));
    },
    async invite(userId) {
      const r = await call(`/api/penas/mine/invite/${encodeURIComponent(userId)}`, { method: 'POST' });
      return r.ok ? null : r.error;
    },
    async kick(userId) {
      apply(await call(`/api/penas/mine/kick/${encodeURIComponent(userId)}`, { method: 'POST' }));
    },
    async leave() {
      apply(await call('/api/penas/mine/leave', { method: 'POST' }));
    },
    clearError() {
      set({ error: null });
    },
  };
});

export async function fetchPenaPreview(code: string): Promise<PenaPreview | null> {
  const r = await call(`/api/penas/join/${encodeURIComponent(code)}`);
  return r.ok ? (r.body as PenaPreview) : null;
}

export function penaLink(code: string): string {
  return `${window.location.origin}/#pena-${code}`;
}

/** `#pena` → { code: null }; `#pena-ABC123` → { code }; otra cosa → null. */
export function penaRoute(hash: string = window.location.hash): { code: string | null } | null {
  if (hash === '#pena') return { code: null };
  const m = /^#pena-([A-Za-z0-9]{6,8})$/.exec(hash);
  return m ? { code: m[1]!.toUpperCase() } : null;
}
