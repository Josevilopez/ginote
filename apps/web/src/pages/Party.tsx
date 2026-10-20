import { useEffect, useState } from 'react';
import { getPlayerName, setPlayerName } from '../store.js';
import { partyInviteUrl, useParty } from '../party.js';
import './Home.css';
import './Party.css';

/**
 * S3-04: pantalla de la pareja. Tres momentos:
 *  1. Te han invitado (`#pareja-ABCD`) y aún no estás dentro: tu nombre + "Unirme".
 *  2. Esperando a la pareja: enlace para compartir.
 *  3. Los dos dentro: el líder busca partida; el otro espera. Al
 *     encontrar mesa, los dos entran solos (enfrente, mismo equipo).
 */
export function Party({ inviteCode, onClose }: { inviteCode: string | null; onClose: () => void }) {
  const { saved, view, error, busy, join, poll, play, cancel, leave } = useParty();
  const [name, setName] = useState(() => getPlayerName());
  const [copied, setCopied] = useState(false);

  const invited = inviteCode !== null && saved?.code !== inviteCode;

  // Preguntar el estado cada segundo mientras estás en esta pantalla.
  useEffect(() => {
    if (!saved) return;
    void poll();
    const id = window.setInterval(() => void poll(), 1000);
    return () => window.clearInterval(id);
  }, [saved?.code, saved?.memberId, poll]);

  // Si el grupo desaparece (salir, caducado) y no hay invitación, a la portada.
  useEffect(() => {
    if (!saved && !invited && !error) onClose();
  }, [saved, invited, error, onClose]);

  if (invited) {
    return (
      <div className="home party">
        <div className="home-inner">
          <h1 className="party-title">Te invitan a jugar de pareja</h1>
          <p className="party-lead">Os sentamos enfrente, en el mismo equipo, contra otra pareja o contra dos jugadores.</p>
          <label className="home-name">
            Tu nombre en la mesa
            <input
              type="text"
              maxLength={20}
              autoComplete="nickname"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
            />
          </label>
          <button
            type="button"
            className="home-choice is-main"
            disabled={busy}
            onClick={() => {
              setPlayerName(name);
              void join(inviteCode!).then((ok) => ok && onClose());
            }}
          >
            <b>Unirme a la pareja</b>
          </button>
          {error && <p className="home-error" role="alert">{error}</p>}
          <button type="button" className="party-secondary" onClick={onClose}>
            Ahora no
          </button>
        </div>
      </div>
    );
  }

  if (!saved) {
    return (
      <div className="home party">
        <div className="home-inner">
          {error && <p className="home-error" role="alert">{error}</p>}
          <button type="button" className="party-secondary" onClick={onClose}>Volver</button>
        </div>
      </div>
    );
  }

  const me = view?.members.find((m) => m.you);
  const mate = view?.members.find((m) => !m.you);
  const leader = view?.members.find((m) => m.leader);
  const url = partyInviteUrl(saved.code);

  const share = async () => {
    const text = `¿Jugamos al guiñote de pareja? ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Guiñote de pareja', text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelado o sin permiso: el enlace sigue visible para copiarlo a mano.
    }
  };

  return (
    <div className="home party">
      <div className="home-inner">
        <h1 className="party-title">Jugar de pareja</h1>

        <div className="party-seats" aria-label="Pareja">
          <Seat name={me?.name ?? getPlayerName()} note="Tú" online />
          <span className="party-amp" aria-hidden="true">&amp;</span>
          {mate ? (
            <Seat name={mate.name} note={mate.online ? 'Conectado' : 'No está en esta pantalla'} online={mate.online} />
          ) : (
            <Seat name="¿?" note="Esperando…" empty />
          )}
        </div>

        {!mate && (
          <div className="party-invite">
            <p>Pásale este enlace a tu pareja:</p>
            <code className="party-link">{url.replace(/^https?:\/\//, '')}</code>
            <button type="button" className="home-choice is-main" onClick={() => void share()}>
              <b>{copied ? '¡Enlace copiado!' : 'Compartir enlace'}</b>
            </button>
          </div>
        )}

        {/* S3-05: la pareja está en la cola. */}
        {mate && view?.searchingMs != null && (
          <div className="party-searching" role="status">
            <b>Buscando partida…</b>
            <span>
              {Math.floor(view.searchingMs / 1000)} s · os sentamos enfrente; si no hay rivales de vuestro nivel, completan bots
            </span>
            {view.youAreLeader && (
              <button type="button" className="party-secondary" onClick={() => void cancel()}>
                Cancelar búsqueda
              </button>
            )}
          </div>
        )}

        {mate && view?.youAreLeader && view.searchingMs == null && (
          <div className="party-go">
            <button type="button" className="home-choice is-main" disabled={busy || !mate.online} onClick={() => void play()}>
              <b>Buscar partida</b>
              <span>Os sentamos enfrente. Si faltan rivales, completan bots.</span>
            </button>
            {!mate.online && <p className="party-hint">Esperando a que {mate.name} vuelva a esta pantalla…</p>}
          </div>
        )}

        {mate && !view?.youAreLeader && view?.searchingMs == null && (
          <p className="party-wait" role="status">
            Esperando a que <b>{leader?.name ?? 'tu pareja'}</b> busque partida…
          </p>
        )}

        {error && <p className="home-error" role="alert">{error}</p>}

        <button type="button" className="party-secondary" onClick={() => void leave()}>
          Salir de la pareja
        </button>
      </div>
    </div>
  );
}

function Seat({ name, note, online, empty }: { name: string; note: string; online?: boolean; empty?: boolean }) {
  const initial = (name.match(/\p{L}/u)?.[0] ?? '?').toUpperCase();
  return (
    <div className={`party-seat ${empty ? 'is-empty' : ''} ${online ? 'is-online' : ''}`}>
      <span className="party-avatar" aria-hidden="true">{empty ? '?' : initial}</span>
      <b>{name}</b>
      <small>{note}</small>
    </div>
  );
}
