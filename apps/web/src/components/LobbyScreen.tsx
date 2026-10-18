import { useEffect, useState } from 'react';
import { useGame } from '../store.js';
import './LobbyScreen.css';

/**
 * Pantalla de espera antes de repartir (sala en lobby). Mismo estilo que
 * la portada: la mesa vista desde arriba con los cuatro asientos (tú
 * abajo, tu pareja enfrente, rivales a los lados), la cuenta atrás hasta
 * que los bots completen la mesa y un botón para invitar a alguien.
 */
export function LobbyScreen(): JSX.Element {
  const lobby = useGame((s) => s.lobby)!;
  const roomCode = useGame((s) => s.roomCode);
  const you = useGame((s) => s.you);
  const seatNames = useGame((s) => s.seatNames);
  const isBot = useGame((s) => s.isBot);
  const leave = useGame((s) => s.leave);

  // Re-render cada 100 ms mientras hay cuenta atrás.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (lobby.endsAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [lobby.endsAt]);

  const remainingMs = lobby.endsAt !== null ? Math.max(0, lobby.endsAt - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const filled = Math.min(lobby.seatsConnected, lobby.seatsTotal);
  const full = filled >= lobby.seatsTotal;
  const me = you ?? 0;

  let status: JSX.Element;
  if (full) status = <>Mesa completa. Repartiendo…</>;
  else if (lobby.endsAt !== null) status = <>Empieza en <b>{remainingSec} s</b>. Si falta gente, juegan bots.</>;
  else status = <>Esperando a que entre alguien más.</>;

  return (
    <div className="lobby">
      <header className="lobby-top">
        <div className="lobby-code">
          Sala<b>{roomCode ?? '····'}</b>
        </div>
        <button className="lobby-leave" type="button" onClick={leave}>
          Salir
        </button>
      </header>

      <div className="lobby-inner">
        <h1 className="lobby-heading">{full ? 'Mesa completa' : 'Buscando jugadores'}</h1>
        <p className="lobby-status" aria-live="polite">{status}</p>

        <div className="lobby-table" role="list" aria-label="Asientos de la mesa">
          {[0, 1, 2, 3].map((seat) => {
            // Posición relativa a mí, igual que en la mesa de juego:
            // 0 abajo (yo), 1 derecha, 2 enfrente (pareja), 3 izquierda.
            const pos = (seat - me + 4) % 4;
            const taken = isBot[seat] === false;
            const isMe = seat === me;
            const isPartner = pos === 2;
            const name = taken ? (seatNames[seat] || 'Jugador') : 'Libre';
            const initial = taken ? (name.match(/\p{L}/u)?.[0] ?? '?').toUpperCase() : '?';
            const role = isMe ? 'Tú' : isPartner ? 'Tu pareja' : 'Rival';
            return (
              <div
                key={seat}
                role="listitem"
                className={`lobby-seat pos-${pos} ${taken ? 'is-taken' : 'is-free'} ${isPartner ? 'is-partner' : ''} ${!taken && lobby.endsAt !== null ? 'is-joining' : ''}`}
              >
                <div className="lobby-avatar" aria-hidden="true">{initial}</div>
                <div className="lobby-name">{name}</div>
                <div className="lobby-role">{role}</div>
              </div>
            );
          })}
        </div>

        {lobby.endsAt !== null && !full && (
          <div className="lobby-bar" aria-hidden="true">
            <div style={{ width: `${Math.min(100, (remainingMs / lobby.windowMs) * 100).toFixed(1)}%` }} />
          </div>
        )}

        {!full && roomCode && <InviteButton code={roomCode} />}
      </div>
    </div>
  );
}

/**
 * "Invitar a alguien": en el móvil abre el menú de compartir del sistema
 * (WhatsApp, etc.); donde no existe (escritorio, o HTTP sin contexto
 * seguro) copia el enlace; y si tampoco se puede, lo muestra para copiarlo.
 */
function InviteButton({ code }: { code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/#${code}`;

  const invite = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Guiñote aragonés', text: `Siéntate conmigo en la sala ${code}`, url });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
        return;
      }
      window.prompt('Copia el enlace de la sala:', url);
    } catch (err) {
      // Cancelar el menú de compartir no es un error.
      if ((err as Error).name !== 'AbortError') window.prompt('Copia el enlace de la sala:', url);
    }
  };

  return (
    <button className="lobby-invite" type="button" onClick={() => void invite()}>
      <b>{copied ? 'Enlace copiado' : 'Invitar a alguien'}</b>
      <span>{copied ? 'Pégalo en WhatsApp o donde quieras.' : 'Comparte el enlace de esta sala para que se siente contigo.'}</span>
    </button>
  );
}
