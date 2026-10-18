import { useGame } from '../store.js';

/**
 * S2-15: aviso del estado de MI conexión con la mesa. Se pinta encima de
 * todo (lobby o partida) cuando el WebSocket se ha caído:
 *  - `reconnecting`: franja superior no bloqueante mientras reintentamos.
 *  - `lost` / `replaced`: tarjeta modal con el motivo y "Volver al inicio".
 */
export function ConnectionBanner(): JSX.Element | null {
  const connection = useGame((s) => s.connection);
  const message = useGame((s) => s.connectionMessage);
  const leave = useGame((s) => s.leave);

  if (connection === 'connected') return null;

  if (connection === 'reconnecting') {
    return (
      <div className="conn-banner" role="status" aria-live="polite">
        <span className="conn-spinner" aria-hidden="true" />
        Conexión perdida — reconectando…
      </div>
    );
  }

  return (
    <div className="conn-overlay" role="alertdialog" aria-live="assertive">
      <div className="conn-card">
        <h2>{connection === 'replaced' ? 'Partida abierta en otro sitio' : 'Has perdido tu asiento'}</h2>
        <p>{message ?? 'No se ha podido recuperar la conexión.'}</p>
        <button className="btn primary" type="button" onClick={leave}>
          Volver al inicio
        </button>
      </div>
    </div>
  );
}
