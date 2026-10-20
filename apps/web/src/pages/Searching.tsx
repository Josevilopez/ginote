import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store.js';
import './Home.css';
import './Searching.css';

const FAN = ['01-oros', '03-copas', '12-espadas', '10-bastos'] as const;

/**
 * S3-05: "Buscando partida". Mientras el servidor busca rivales de tu
 * nivel; si en `fillAfterMs` no los hay, completa la mesa con bots.
 */
export function Searching() {
  const queue = useGame((s) => s.queue);
  const cancel = useGame((s) => s.cancelQueue);
  // Reloj local entre actualizaciones del servidor (llegan cada segundo).
  const base = useRef<{ at: number; waited: number }>({ at: Date.now(), waited: 0 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (queue) base.current = { at: Date.now(), waited: queue.waitedMs };
  }, [queue?.waitedMs]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!queue) return null;

  const waited = base.current.waited + (now - base.current.at);
  const secs = Math.floor(waited / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const pct = Math.min(1, waited / queue.fillAfterMs);
  const left = Math.max(0, Math.ceil((queue.fillAfterMs - waited) / 1000));
  const others = Math.max(0, queue.players - 1);

  return (
    <div className="home searching">
      <div className="home-inner">
        <div className="searching-fan" aria-hidden="true">
          {FAN.map((c) => (
            <img key={c} src={`/cards/sprite/${c}.png`} alt="" draggable={false} />
          ))}
        </div>
        <h1 className="searching-title">Buscando partida</h1>
        <p className="searching-clock" aria-live="off">{clock}</p>
        <p className="searching-who" role="status">
          {others === 0
            ? 'Buscando rivales de tu nivel…'
            : `${others} ${others === 1 ? 'jugador más buscando' : 'jugadores más buscando'} ahora`}
        </p>
        <div className="searching-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${pct})` }} />
        </div>
        <p className="searching-hint">
          {left > 0
            ? `Si en ${left} s no hay mesa completa, la terminamos con bots.`
            : 'Completando la mesa…'}
        </p>
        <button type="button" className="searching-cancel" onClick={cancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
