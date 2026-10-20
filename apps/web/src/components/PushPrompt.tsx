import { useEffect, useState } from 'react';
import { dismissPrompt, promptDismissed, usePush } from '../push.js';
import './PushPrompt.css';

/**
 * S5-02: tarjeta "¿Te avisamos cuando un amigo te invite?". Sale en la
 * pantalla de Amigos cuando ya tienes (o has pedido) algún amigo; nunca al
 * entrar. El permiso del navegador solo se pide al pulsar "Sí, avisadme".
 */
export function PushPrompt() {
  const { status, busy, error, check, enable } = usePush();
  const [hidden, setHidden] = useState(() => promptDismissed());
  const [justDenied, setJustDenied] = useState(false);

  useEffect(() => {
    void check();
  }, [check]);

  if (hidden && !justDenied) return null;

  const close = () => {
    dismissPrompt();
    setHidden(true);
    setJustDenied(false);
  };

  if (justDenied) {
    return (
      <div className="push-card" role="status">
        <p>
          <b>Avisos bloqueados.</b> Si cambias de idea, permite las notificaciones de esta web en los ajustes del navegador.
        </p>
        <div>
          <button type="button" className="is-no" onClick={close}>
            Vale
          </button>
        </div>
      </div>
    );
  }

  if (status === 'ios-install') {
    return (
      <div className="push-card" role="region" aria-label="Avisos en el iPhone">
        <p>
          <b>¿Quieres avisos en el iPhone?</b> Primero añade el guiñote a tu pantalla de inicio:
        </p>
        <ol>
          <li>
            Toca <b>Compartir</b> <ShareIcon /> (abajo en Safari).
          </li>
          <li>
            Elige <b>Añadir a pantalla de inicio</b>.
          </li>
          <li>Abre el guiñote desde ese icono y vuelve aquí.</li>
        </ol>
        <div>
          <button type="button" className="is-no" onClick={close}>
            Entendido
          </button>
        </div>
      </div>
    );
  }

  if (status !== 'off') return null;

  return (
    <div className="push-card" role="region" aria-label="Avisos">
      <p>
        <b>¿Te avisamos cuando un amigo te invite a jugar?</b> Te llegará un aviso al móvil aunque no tengas la web abierta. Puedes
        quitarlo cuando quieras en tu perfil.
      </p>
      <div>
        <button
          type="button"
          className="is-yes"
          disabled={busy}
          onClick={() =>
            void enable().then((ok) => {
              if (ok) close();
              else if (usePush.getState().status === 'denied') setJustDenied(true);
            })
          }
        >
          Sí, avisadme
        </button>
        <button type="button" className="is-no" onClick={close}>
          Ahora no
        </button>
      </div>
      {error && <p role="alert" className="push-error">{error}</p>}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg className="push-share" viewBox="0 0 24 24" width="18" height="18" aria-label="(el cuadrado con una flecha hacia arriba)" role="img">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11H6v9h12v-9h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** S5-02: sección "Avisos" del perfil: activar/desactivar en este dispositivo y qué avisos quieres. */
export function PushSettings() {
  const { status, prefs, busy, error, check, enable, disable, loadPrefs, savePrefs } = usePush();
  useEffect(() => {
    void check();
    void loadPrefs();
  }, [check, loadPrefs]);

  if (status === 'loading' || status === 'server-off') return null;

  return (
    <div className="push-settings">
      {status === 'on' && <p className="push-state is-on">Los avisos están activados en este dispositivo.</p>}
      {status === 'off' && <p className="push-state">Los avisos están desactivados en este dispositivo.</p>}
      {status === 'denied' && (
        <p className="push-state">Este navegador tiene bloqueados los avisos de esta web. Para activarlos, permítelos en los ajustes del navegador.</p>
      )}
      {status === 'unsupported' && <p className="push-state">Este navegador no admite avisos.</p>}
      {status === 'ios-install' && (
        <p className="push-state">
          En el iPhone, los avisos solo funcionan si añades el guiñote a la pantalla de inicio (Compartir <ShareIcon /> → Añadir a pantalla de
          inicio) y lo abres desde ahí.
        </p>
      )}

      {status === 'off' && (
        <button type="button" className="push-toggle is-yes" disabled={busy} onClick={() => void enable()}>
          Activar avisos
        </button>
      )}

      {status === 'on' && prefs && (
        <fieldset className="push-prefs">
          <legend>Avisarme de…</legend>
          <label>
            <input type="checkbox" checked={prefs.invite} onChange={(e) => void savePrefs({ invite: e.target.checked })} />
            Invitaciones a jugar
          </label>
          <label>
            <input type="checkbox" checked={prefs.request} onChange={(e) => void savePrefs({ request: e.target.checked })} />
            Solicitudes de amistad
          </label>
        </fieldset>
      )}

      {status === 'on' && (
        <button type="button" className="push-toggle" disabled={busy} onClick={() => void disable()}>
          Desactivar en este dispositivo
        </button>
      )}
      {error && <p role="alert" className="push-error">{error}</p>}
    </div>
  );
}
