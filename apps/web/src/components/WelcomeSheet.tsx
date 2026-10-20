import { useEffect, useRef, useState } from 'react';
import { renderGoogleButton, useAccount } from '../account.js';
import './WelcomeSheet.css';

const SEEN_KEY = 'guinote:welcomeSeen';

function seen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Sin localStorage volverá a salir la próxima vez; no pasa nada.
  }
}

/**
 * Bienvenida (una sola vez por navegador): entrar con Google o seguir
 * como invitado, explicado en palabras sencillas. No sale si el login no
 * está configurado o si ya has iniciado sesión.
 */
export function WelcomeSheet() {
  const { status, googleClientId, me } = useAccount();
  const [open, setOpen] = useState(() => !seen());
  const [gsiFailed, setGsiFailed] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const visible = open && status === 'ready' && !!googleClientId && !me;

  const close = () => {
    markSeen();
    setOpen(false);
  };

  // Si entra con Google, la bienvenida ya ha cumplido.
  useEffect(() => {
    if (me && open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (!visible || !btnRef.current || !googleClientId) return;
    // Foco en la ventana (lectores de pantalla), sin destacar ningún botón.
    dialogRef.current?.focus();
    renderGoogleButton(btnRef.current, googleClientId, {
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      locale: 'es',
      width: Math.min(300, btnRef.current.clientWidth || 300),
    }).catch(() => setGsiFailed(true));
  }, [visible, googleClientId]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="welcome-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} tabIndex={-1} className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <h2 id="welcome-title">¿Guardamos tus partidas?</h2>
        <p className="welcome-free">
          <b>No hace falta registrarse.</b> Puedes jugar ya mismo como invitado.
        </p>
        <p className="welcome-if">Si entras con tu cuenta de Google:</p>
        <ul className="welcome-list">
          <li>
            <span aria-hidden="true">💾</span> Tus partidas y tu nivel no se pierden nunca.
          </li>
          <li>
            <span aria-hidden="true">📱</span> Sigues donde lo dejaste, en el móvil o en el ordenador.
          </li>
          <li>
            <span aria-hidden="true">🏆</span> Ves cuántas partidas llevas y cuántas has ganado.
          </li>
        </ul>
        <div ref={btnRef} className="welcome-google" />
        {gsiFailed && <p className="welcome-error">No se pudo cargar el botón de Google. Puedes entrar más tarde desde arriba.</p>}
        <button type="button" className="welcome-guest" onClick={close}>
          Seguir como invitado
        </button>
        <p className="welcome-later">Puedes entrar cuando quieras desde arriba a la derecha.</p>
      </div>
    </div>
  );
}
