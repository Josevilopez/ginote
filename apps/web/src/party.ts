/**
 * S3-04: pareja fija en el cliente.
 *
 * Guardamos en sessionStorage el grupo (`code` + `memberId`, el secreto
 * de tu plaza) para que sobreviva a recargar y a volver de una partida.
 * Mientras se ve la pantalla de pareja se pregunta el estado cada
 * segundo; cuando el líder busca partida, los dos reciben la mesa con su
 * token de asiento y entran solos.
 */
import { create } from 'zustand';
import { getPlayerName, useGame } from './store.js';
import { apiFetch, ensurePlayerId } from './api.js';

export interface PartyView {
  code: string;
  youAreLeader: boolean;
  members: { name: string; leader: boolean; online: boolean; you: boolean }[];
  match: { id: string; roomCode: string; token: string } | null;
  /** S3-05: ms que lleva la pareja en la cola, o null. */
  searchingMs: number | null;
}

interface Saved {
  code: string;
  memberId: string;
  /** Última mesa a la que ya entramos (para no volver a entrar al volver). */
  joinedMatchId: string | null;
}

const KEY = 'guinote:party';

function load(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(v: Saved | null): void {
  try {
    if (v) window.sessionStorage.setItem(KEY, JSON.stringify(v));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // sessionStorage no disponible: la pareja dura lo que la pestaña.
  }
}

interface PartyState {
  saved: Saved | null;
  view: PartyView | null;
  error: string | null;
  busy: boolean;
  create: () => Promise<void>;
  join: (code: string) => Promise<boolean>;
  poll: () => Promise<void>;
  play: () => Promise<void>;
  cancel: () => Promise<void>;
  leave: () => Promise<void>;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  // El jugador de cada miembro se toma al crear o unirse a la pareja.
  await ensurePlayerId();
  const r = await apiFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T;
  return { ok: r.ok, status: r.status, data };
}

export const useParty = create<PartyState>((set, get) => {
  /** Si el líder ya buscó partida y aún no entramos en esa mesa, entrar. */
  const maybeEnter = (view: PartyView) => {
    const saved = get().saved;
    if (!saved || !view.match || view.match.id === saved.joinedMatchId) return;
    const next = { ...saved, joinedMatchId: view.match.id };
    save(next);
    set({ saved: next });
    useGame.getState().joinReserved(view.match.roomCode, view.match.token);
  };

  return {
    saved: load(),
    view: null,
    error: null,
    busy: false,

    async create() {
      set({ busy: true, error: null });
      try {
        const r = await post<{ code: string; memberId: string; view: PartyView; error?: string }>('/api/parties', {
          name: getPlayerName(),
        });
        if (!r.ok) throw new Error(r.data.error ?? `HTTP ${r.status}`);
        const saved = { code: r.data.code, memberId: r.data.memberId, joinedMatchId: null };
        save(saved);
        set({ saved, view: r.data.view });
      } catch {
        set({ error: 'No se pudo crear la pareja. ¿Hay conexión?' });
      } finally {
        set({ busy: false });
      }
    },

    async join(code) {
      set({ busy: true, error: null });
      try {
        const prev = get().saved;
        if (prev && prev.code !== code) await get().leave();
        const r = await post<{ code: string; memberId: string; view: PartyView; error?: string }>(
          `/api/parties/${encodeURIComponent(code)}/join`,
          { name: getPlayerName() },
        );
        if (!r.ok) {
          set({ error: r.data.error ?? 'No se pudo entrar en la pareja' });
          return false;
        }
        const saved = { code: r.data.code, memberId: r.data.memberId, joinedMatchId: null };
        save(saved);
        set({ saved, view: r.data.view });
        return true;
      } catch {
        set({ error: 'No se pudo entrar en la pareja. ¿Hay conexión?' });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    async poll() {
      const saved = get().saved;
      if (!saved) return;
      try {
        const r = await apiFetch(`/api/parties/${saved.code}?member=${encodeURIComponent(saved.memberId)}`);
        if (r.status === 404) {
          // El grupo caducó o el servidor se reinició.
          save(null);
          set({ saved: null, view: null, error: 'La pareja ya no existe. Crea otra.' });
          return;
        }
        if (!r.ok) return;
        const view = (await r.json()) as PartyView;
        set({ view });
        maybeEnter(view);
      } catch {
        // Sin red un momento: seguimos preguntando.
      }
    },

    async play() {
      const saved = get().saved;
      if (!saved) return;
      set({ busy: true, error: null });
      try {
        const r = await post<PartyView & { error?: string }>(`/api/parties/${saved.code}/play`, { member: saved.memberId });
        if (!r.ok) {
          set({ error: r.data.error ?? 'No se pudo buscar partida' });
          return;
        }
        set({ view: r.data });
        maybeEnter(r.data);
      } catch {
        set({ error: 'No se pudo buscar partida. ¿Hay conexión?' });
      } finally {
        set({ busy: false });
      }
    },

    async cancel() {
      const saved = get().saved;
      if (!saved) return;
      const r = await post<PartyView>(`/api/parties/${saved.code}/cancel`, { member: saved.memberId }).catch(() => null);
      if (r?.ok) set({ view: r.data });
    },

    async leave() {
      const saved = get().saved;
      save(null);
      set({ saved: null, view: null, error: null });
      if (saved) await post(`/api/parties/${saved.code}/leave`, { member: saved.memberId }).catch(() => undefined);
    },
  };
});

/** Enlace de invitación: `https://host/#pareja-ABCD`. */
export function partyInviteUrl(code: string): string {
  return `${window.location.origin}/#pareja-${code}`;
}

/** Código de pareja del hash (`#pareja-ABCD`), si lo hay. */
export function partyCodeFromHash(hash: string = window.location.hash): string | null {
  const m = /^#pareja-([A-Za-z0-9]{4})$/.exec(hash);
  return m ? m[1]!.toUpperCase() : null;
}
