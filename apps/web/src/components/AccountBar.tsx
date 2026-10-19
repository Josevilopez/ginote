import { useEffect, useRef, useState } from 'react';
import { loadGoogleScript, useAccount } from '../account.js';
import './AccountBar.css';

/**
 * S3-01: bloque de cuenta en la portada.
 *  - Invitado: botón de Google y una línea de por qué entrar.
 *  - Con cuenta: nombre, partidas guardadas y menú (salir, mis datos,
 *    borrar cuenta).
 * Si el servidor no tiene GOOGLE_CLIENT_ID, no se pinta nada.
 */
export function AccountBar({ onGivenName }: { onGivenName: (name: string) => void }) {
  const { status, googleClientId, me, stats, error, init, login, logout, deleteAccount } = useAccount();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      <button
        type="button"
        className="account-summary"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setConfirmDelete(false);
        }}
      >
        <span className="account-avatar" aria-hidden="true">{initial}</span>
        <span className="account-who">
          <b>{label}</b>
          <small>
            {stats && stats.games > 0
              ? `${stats.games} ${stats.games === 1 ? 'partida guardada' : 'partidas guardadas'} · ${stats.wins} ganadas`
              : 'Tus partidas se guardan en tu cuenta'}
          </small>
        </span>
        <span className="account-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="account-menu">
          {me.email && <p className="account-email">{me.email}</p>}
          <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
          <a href="/api/me/data" download="guinote-mis-datos.json">Descargar mis datos</a>
          {!confirmDelete ? (
            <button type="button" className="is-danger" onClick={() => setConfirmDelete(true)}>
              Borrar mi cuenta
            </button>
          ) : (
            <div className="account-confirm" role="alert">
              <p>Se borran tu cuenta, tus partidas y tu nivel. No se puede deshacer.</p>
              <div>
                <button type="button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    void deleteAccount().then((ok) => ok && setOpen(false));
                  }}
                >
                  Sí, borrar
                </button>
              </div>
            </div>
          )}
          {error && <p className="account-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
