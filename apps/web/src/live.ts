import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { shouldPoll } from './idle.js';

const POLL_MS = 30_000;

/**
 * Jugadores conectados ahora (para la portada). null = no se enseña: el
 * servidor no publica la cifra si es pequeña, o no se pudo consultar.
 * Pregunta cada 30 s, solo con la pestaña visible y alguien delante (idle.ts).
 */
export function useLivePlayers(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!shouldPoll()) return;
      apiFetch('/api/live')
        .then((r) => (r.ok ? r.json() : { players: null }))
        .then((d: { players: number | null }) => alive && setN(typeof d.players === 'number' ? d.players : null))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);
  return n;
}
