/**
 * S5-05: torneos en el cliente. Lista en `#torneos`, cada torneo en
 * `#torneo-<id>`.
 */
export type TorneoStatus = 'open' | 'running' | 'finished' | 'cancelled';
import { apiFetch } from './api.js';

export interface TorneoSummary {
  id: string;
  name: string;
  status: TorneoStatus;
  size: number;
  partidas: number;
  roundDays: number;
  signupUntil: string;
  pairs: number;
  champion: string | null;
  my: { status: 'invited' | 'waiting' | 'in'; partner: string; entryId: string } | null;
}

export interface PairView {
  id: string;
  names: string;
  confirmed: boolean;
  you: boolean;
}

export interface TorneoDetail extends TorneoSummary {
  entries: PairView[];
  rounds: {
    name: string;
    deadline: string | null;
    matches: {
      id: string;
      a: PairView | null;
      b: PairView | null;
      winner: string | null;
      result: 'played' | 'bye' | 'walkover' | 'sorteo' | null;
      score: [number, number] | null;
    }[];
  }[];
  next: { round: string; rival: string; deadline: string; live: boolean } | null;
  eliminated: boolean;
  isAdmin: boolean;
}

type R<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init: RequestInit = {}): Promise<R<T>> {
  try {
    const r = await apiFetch(url, {
      credentials: 'same-origin',
      ...init,
      ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    });
    const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok || !body) return { ok: false, error: body?.error ?? 'Algo ha fallado. Inténtalo otra vez.' };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: 'Sin conexión. Inténtalo otra vez.' };
  }
}

export const fetchTorneos = () => call<{ canCreate: boolean; torneos: TorneoSummary[] }>('/api/torneos');
export const fetchTorneo = (id: string) => call<TorneoDetail>(`/api/torneos/${encodeURIComponent(id)}`);
export const torneoAction = (id: string, action: 'signup' | 'confirm' | 'withdraw' | 'start' | 'cancel', body?: unknown) =>
  call<TorneoDetail>(`/api/torneos/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
export const playTorneo = (id: string) => call<{ code: string; token: string }>(`/api/torneos/${encodeURIComponent(id)}/play`, { method: 'POST' });
export const createTorneo = (body: { name: string; size: number; partidas: number; roundDays: number; signupUntil: string }) =>
  call<TorneoDetail>('/api/torneos', { method: 'POST', body: JSON.stringify(body) });

/** `#torneos` → { id: null }; `#torneo-<id>` → { id }; otra cosa → null. */
export function torneoRoute(hash: string = window.location.hash): { id: string | null } | null {
  if (hash === '#torneos') return { id: null };
  const m = /^#torneo-([A-Za-z0-9-]{8,40})$/.exec(hash);
  return m ? { id: m[1]! } : null;
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
