import { useEffect, useRef, useState } from 'react';
import { loadGoogleScript, useAccount } from '../account.js';
import './AccountBar.css';

/**
 * S3-01: bloque de cuenta en la portada.
 *  - Invitado: botón de Google y una línea de por qué entrar.
 *  - Con cuenta: nombre y partidas guardadas; enlaza a "Mi perfil".
 * Si el servidor no tiene GOOGLE_CLIENT_ID, no se pinta nada.
 */
export function AccountBar({ onGivenName }: { onGivenName: (name: string) => void }) {
  const { status, googleClientId, me, stats, error, init, login } = useAccount();
  const [gsiFailed, setGsiFailed] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  // El callback de Google se registra una vez; leemos la última versión.
  const onNameRef = useRef(onGivenName);
  onNameRef.current = onGivenName;

  useEffect(() => {
    void init();
  }, [init]);

  // Con sesión abierta, si en este dispositivo aún te llamas "Jugador",
  // usamos tu nombre de pila (la portada decide si lo cambia).
  useEffect(() => {
    const first = me?.name?.trim().split(/\s+/)[0];
    if (first) onNameRef.current(first);
  }, [me?.name]);

  useEffect(() => {
    if (status !== 'ready' || !googleClientId || me) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        const el = btnRef.current;
        if (cancelled || !el || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          callback: (res) => {
            void login(res.credential).then((given) => {
              if (given) onNameRef.current(given);
            });
          },
        });
        el.innerHTML = '';
        window.google.accounts.id.renderButton(el, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'es',
          logo_alignment: 'left',
          width: Math.min(320, el.clientWidth || 320),
        });
      })
      .catch(() => {
        if (!cancelled) setGsiFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, googleClientId, me, login]);

  if (status !== 'ready' || !googleClientId) return null;

  if (!me) {
    return (
      <div className="account account-guest">
        <p className="account-why">
          <b>Guarda tu progreso.</b> Entra con Google y tus partidas te siguen al móvil o al ordenador. Si no, juegas como invitado.
        </p>
        <div ref={btnRef} className="account-gsi" />
        {gsiFailed && <p className="account-error">No se pudo cargar el botón de Google.</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
      </div>
    );
  }

  const label = me.name ?? me.email ?? 'Tu cuenta';
  const initial = (label.match(/\p{L}/u)?.[0] ?? '?').toUpperCase();
  return (
    <div className="account account-in">
      {/* S3-02: la tarjeta lleva a "Mi perfil" (allí están salir, mis
          datos y borrar cuenta). */}
      <a className="account-summary" href="#perfil">
        <span className="account-avatar" aria-hidden="true">{initial}</span>
        <span className="account-who">
          <b>{label}</b>
          <small>
            {stats && stats.games > 0
              ? `${stats.games} ${stats.games === 1 ? 'partida guardada' : 'partidas guardadas'} · ${stats.wins} ganadas`
              : 'Tus partidas se guardan en tu cuenta'}
          </small>
        </span>
        <span className="account-caret">Mi perfil ›</span>
      </a>
    </div>
  );
}
