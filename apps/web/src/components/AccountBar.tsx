import { useEffect, useRef, useState } from 'react';
import { onGoogleGivenName, renderGoogleButton, useAccount } from '../account.js';
import './AccountBar.css';

/**
 * S3-01: cuenta en la esquina de la portada (discreta: se usa poco).
 *  - Invitado: botón compacto "Iniciar sesión" de Google.
 *  - Con cuenta: tu inicial en un círculo, que lleva a "Mi perfil".
 * Si el servidor no tiene GOOGLE_CLIENT_ID, no se pinta nada.
 * Los errores los pinta la portada (`useAccount().error`).
 */
export function AccountBar({ onGivenName }: { onGivenName: (name: string) => void }) {
  const { status, googleClientId, me, init } = useAccount();
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
  // S4-04: en un dispositivo nuevo, mejor el nombre que ya usas en tu cuenta.
  const publicName = useAccount((st) => st.stats?.publicName ?? null);
  useEffect(() => {
    const preferred = publicName ?? me?.name?.trim().split(/\s+/)[0];
    if (preferred) onNameRef.current(preferred);
  }, [me?.name, publicName]);

  // Al entrar con Google (desde aquí o desde la bienvenida), el nombre de pila.
  useEffect(() => onGoogleGivenName((given) => onNameRef.current(given)), []);

  useEffect(() => {
    if (status !== 'ready' || !googleClientId || me || !btnRef.current) return;
    let cancelled = false;
    renderGoogleButton(btnRef.current, googleClientId, {
      theme: 'filled_black',
      size: 'medium',
      shape: 'pill',
      text: 'signin',
      locale: 'es',
    }).catch(() => {
      if (!cancelled) setGsiFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [status, googleClientId, me]);

  if (status !== 'ready' || !googleClientId || (gsiFailed && !me)) return null;

  if (!me) {
    return <div ref={btnRef} className="account-gsi" title="Entra con Google para guardar tus partidas" />;
  }

  const label = me.name ?? me.email ?? 'Tu cuenta';
  const initial = (label.match(/\p{L}/u)?.[0] ?? '?').toUpperCase();
  return (
    <a className="account-me" href="#perfil" aria-label={`Mi perfil (${label})`} title="Mi perfil">
      <span className="account-avatar" aria-hidden="true">{initial}</span>
    </a>
  );
}

/** Una línea bajo los botones para invitados: por qué entrar con Google. */
export function AccountHint() {
  const { status, googleClientId, me } = useAccount();
  if (status !== 'ready' || !googleClientId || me) return null;
  return <p className="account-hint">Inicia sesión con Google (arriba) para guardar tus partidas en el móvil y el ordenador.</p>;
}
