import { useEffect, useState } from 'react';
import { useGame } from '../store.js';
import { InviteFriends } from './InviteFriends.js';
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
  const swapSeats = useGame((s) => s.swapSeats);
  const startPrivate = useGame((s) => s.startPrivate);

  // Re-render cada 100 ms mientras hay cuenta atrás.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (lobby.endsAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [lobby.endsAt]);

  // S3-03 (anfitrión de mesa privada): asiento seleccionado para mover y
  // nivel de los bots con los que se completará la mesa al empezar.
  const [picked, setPicked] = useState<number | null>(null);
  const [botLevel, setBotLevel] = useState<1 | 2>(2);
  // S3-07: formato de la mesa (por defecto 1 coto a 3 partidas).
  const [partidasPorCoto, setPartidas] = useState(3);
  const [cotosParaGanar, setCotos] = useState(1);
  useEffect(() => setPicked(null), [seatNames.join('|')]);

  const remainingMs = lobby.endsAt !== null ? Math.max(0, lobby.endsAt - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const filled = Math.min(lobby.seatsConnected, lobby.seatsTotal);
  const full = filled >= lobby.seatsTotal;
  const me = you ?? 0;
  const priv = lobby.isPrivate;
  const amHost = priv && lobby.hostSeat === me;
  const hostName = lobby.hostSeat !== null ? seatNames[lobby.hostSeat] || 'el anfitrión' : 'el anfitrión';

  let heading: string;
  let status: JSX.Element;
  if (priv) {
    heading = 'Mesa privada';
    status = amHost
      ? picked !== null
        ? <>Ahora toca el asiento al que quieres moverlo.</>
        : <>Toca dos asientos para cambiarlos de sitio y empieza cuando quieras.</>
      : <>Esperando a que <b>{hostName}</b> empiece la partida.</>;
  } else {
    heading = full ? 'Mesa completa' : 'Buscando jugadores';
    if (full) status = <>Mesa completa. Repartiendo…</>;
    else if (lobby.endsAt !== null) status = <>Empieza en <b>{remainingSec} s</b>. Si falta gente, juegan bots.</>;
    else status = <>Esperando a que entre alguien más.</>;
  }

  const onSeat = (seat: number) => {
    if (!amHost) return;
    if (picked === null) {
      setPicked(seat);
      return;
    }
    if (picked !== seat) swapSeats(picked, seat);
    setPicked(null);
  };

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
        <h1 className="lobby-heading">{heading}</h1>
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
            const role = (isMe ? 'Tú' : isPartner ? 'Tu pareja' : 'Rival') + (priv && lobby.hostSeat === seat ? ' · anfitrión' : '');
            const cls = `lobby-seat pos-${pos} ${taken ? 'is-taken' : 'is-free'} ${isPartner ? 'is-partner' : ''} ${!taken && !priv && lobby.endsAt !== null ? 'is-joining' : ''} ${amHost ? 'is-movable' : ''} ${picked === seat ? 'is-picked' : ''}`;
            const content = (
              <>
                <div className="lobby-avatar" aria-hidden="true">{initial}</div>
                <div className="lobby-name">{name}</div>
                <div className="lobby-role">{role}</div>
              </>
            );
            return amHost ? (
              <button
                key={seat}
                type="button"
                role="listitem"
                className={cls}
                aria-pressed={picked === seat}
                aria-label={`${name}, ${role}. ${picked === null ? 'Tocar para mover' : 'Tocar para cambiar aquí'}`}
                onClick={() => onSeat(seat)}
              >
                {content}
              </button>
            ) : (
              <div key={seat} role="listitem" className={cls}>
                {content}
              </div>
            );
          })}
        </div>

        {!priv && lobby.endsAt !== null && !full && (
          <div className="lobby-bar" aria-hidden="true">
            <div style={{ width: `${Math.min(100, (remainingMs / lobby.windowMs) * 100).toFixed(1)}%` }} />
          </div>
        )}

        {amHost && (
          <div className="lobby-host">
            <div className="lobby-level" role="radiogroup" aria-label="Nivel de los bots">
              <span>Bots para los huecos</span>
              <div className="lobby-level-options">
                {([1, 2] as const).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    role="radio"
                    aria-checked={botLevel === lv}
                    className={botLevel === lv ? 'is-on' : ''}
                    onClick={() => setBotLevel(lv)}
                  >
                    {lv === 1 ? 'Fácil' : 'Normal'}
                  </button>
                ))}
              </div>
            </div>
            <div className="lobby-format" aria-label="Formato de la partida">
              <Stepper
                label="Partidas por coto"
                value={partidasPorCoto}
                min={1}
                max={5}
                onChange={setPartidas}
              />
              <Stepper
                label="Cotos para ganar"
                hint={cotosParaGanar === 1 ? 'un solo coto' : `al mejor de ${cotosParaGanar * 2 - 1}`}
                value={cotosParaGanar}
                min={1}
                max={3}
                onChange={setCotos}
              />
            </div>
            <button
              className="lobby-start"
              type="button"
              onClick={() => startPrivate(botLevel, { partidasPorCoto, cotosParaGanar })}
            >
              <b>Empezar partida</b>
              <span>
                {cotosParaGanar === 1
                  ? `Un coto a ${partidasPorCoto} partidas.`
                  : `Match a ${cotosParaGanar} cotos de ${partidasPorCoto} partidas.`}{' '}
                {full ? 'Estáis los cuatro.' : `Faltan ${lobby.seatsTotal - filled}: jugarán bots.`}
              </span>
            </button>
          </div>
        )}

        {!full && roomCode && <InviteButton code={roomCode} secondary={amHost} />}
        {/* S5-01: en una mesa privada, invitar a un amigo conectado. */}
        {priv && !full && roomCode && <InviteFriends kind="mesa" code={roomCode} />}
      </div>
    </div>
  );
}

/** S3-07: selector numérico compacto (− valor +) para el formato de la mesa. */
function Stepper(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}): JSX.Element {
  const { label, hint, value, min, max, onChange } = props;
  return (
    <div className="lobby-stepper">
      <span className="lobby-stepper-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <div className="lobby-stepper-ctrl">
        <button type="button" aria-label={`Menos ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`Más ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

/**
 * "Invitar a alguien": en el móvil abre el menú de compartir del sistema
 * (WhatsApp, etc.); donde no existe (escritorio, o HTTP sin contexto
 * seguro) copia el enlace; y si tampoco se puede, lo muestra para copiarlo.
 */
function InviteButton({ code, secondary = false }: { code: string; secondary?: boolean }): JSX.Element {
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
    <button className={`lobby-invite${secondary ? ' is-secondary' : ''}`} type="button" onClick={() => void invite()}>
      <b>{copied ? 'Enlace copiado' : 'Invitar a alguien'}</b>
      <span>{copied ? 'Pégalo en WhatsApp o donde quieras.' : 'Comparte el enlace de esta sala para que se siente contigo.'}</span>
    </button>
  );
}
