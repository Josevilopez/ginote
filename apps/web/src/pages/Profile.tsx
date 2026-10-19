import { useEffect, useState } from 'react';
import { useAccount } from '../account.js';
import './Home.css';
import './Profile.css';

/**
 * S3-02: "Mi perfil". Mismo tapete que la portada: quién eres, desde
 * cuándo juegas y tus partidas. Sin ELO todavía (llega con el ranking).
 * Aquí viven también las acciones de la cuenta (salir, mis datos, borrar).
 */
export function Profile({ onBack }: { onBack: () => void }) {
  const { status, me, stats, error, init, refresh, logout, deleteAccount } = useAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void init();
    // Al abrir el perfil, partidas al día (puede que vengas de jugar).
    void refresh();
  }, [init, refresh]);

  // Sin sesión (cerraste sesión o borraste la cuenta) → a la portada.
  useEffect(() => {
    if (status === 'ready' && !me) onBack();
  }, [status, me, onBack]);

  if (!me) return <div className="home" />;

  const label = me.name ?? me.email ?? 'Tu cuenta';
  const initial = (label.match(/\p{L}/u)?.[0] ?? '?').toUpperCase();
  const games = stats?.games ?? 0;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const pct = games > 0 ? Math.round((wins / games) * 100) : null;
  const since = me.since ? sinceText(me.since) : null;

  return (
    <div className="home profile">
      <div className="home-inner">
        <button type="button" className="profile-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Volver
        </button>

        <header className="profile-head">
          <div className="profile-avatar" aria-hidden="true">{initial}</div>
          <h1 className="profile-name">{label}</h1>
          {me.email && me.name && <p className="profile-email">{me.email}</p>}
          {since && <p className="profile-since">Jugando desde {since}</p>}
        </header>

        <section aria-labelledby="profile-stats-title">
          <h2 id="profile-stats-title" className="home-section">Tus partidas</h2>
          {games > 0 ? (
            <div className="profile-stats">
              <Stat value={games} label={games === 1 ? 'jugada' : 'jugadas'} />
              <Stat value={wins} label={wins === 1 ? 'ganada' : 'ganadas'} tone="win" />
              <Stat value={losses} label={losses === 1 ? 'perdida' : 'perdidas'} tone="loss" />
              {pct !== null && <Stat value={`${pct} %`} label="de victorias" wide />}
            </div>
          ) : (
            <div className="profile-empty">
              <p>Aún no has terminado ninguna partida online.</p>
              <button type="button" className="home-choice is-main" onClick={onBack}>
                <b>A la mesa</b>
              </button>
            </div>
          )}
          <p className="profile-note">
            Cuentan las partidas online con otros jugadores. Las de práctica contra bots y las mesas privadas no.
          </p>
        </section>

        <section className="profile-account" aria-labelledby="profile-account-title">
          <h2 id="profile-account-title" className="home-section">Cuenta</h2>
          <div className="profile-actions">
            <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
            <a href="/api/me/data" download="guinote-mis-datos.json">Descargar mis datos</a>
            {!confirmDelete ? (
              <button type="button" className="is-danger" onClick={() => setConfirmDelete(true)}>
                Borrar mi cuenta
              </button>
            ) : (
              <div className="profile-confirm" role="alert">
                <p>Se borran tu cuenta y todas tus partidas. No se puede deshacer.</p>
                <div>
                  <button type="button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                  <button type="button" className="is-danger" onClick={() => void deleteAccount()}>
                    Sí, borrar
                  </button>
                </div>
              </div>
            )}
          </div>
          {error && <p className="home-error" role="alert">{error}</p>}
        </section>
      </div>
    </div>
  );
}

function Stat({ value, label, tone, wide }: { value: number | string; label: string; tone?: 'win' | 'loss'; wide?: boolean }) {
  return (
    <div className={`profile-stat ${tone ? `is-${tone}` : ''} ${wide ? 'is-wide' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** "octubre de 2026". */
function sinceText(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}
