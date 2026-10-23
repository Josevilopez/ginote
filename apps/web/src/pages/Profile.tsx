import { useEffect, useState } from 'react';
import { fetchMyResults, useAccount, type ResultRow } from '../account.js';
import './Home.css';
import './Profile.css';
import { DivisionBadge } from '../components/DivisionBadge.js';
import { PlacePicker } from '../components/PlacePicker.js';
import { PushSettings } from '../components/PushPrompt.js';
import { apiUrl } from '../api.js';
import { DIVISIONS, PLACEMENT_GAMES, divisionFor, divisionName, nextDivision } from '@guinote/protocol';

/**
 * S3-02: "Mi perfil". Mismo tapete que la portada: quién eres, desde
 * cuándo juegas y tus partidas. Sin ELO todavía (llega con el ranking).
 * Aquí viven también las acciones de la cuenta (salir, mis datos, borrar).
 */
export function Profile({ onBack }: { onBack: () => void }) {
  const { status, me, stats, error, init, refresh, logout, deleteAccount, season, trophies } = useAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // S4-01: últimas partidas (null = cargando o sin datos).
  const [history, setHistory] = useState<ResultRow[] | null>(null);
  useEffect(() => {
    void fetchMyResults().then(setHistory);
  }, []);

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
          <svg className="back-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Volver
        </button>

        <header className="profile-head">
          <div className="profile-avatar" aria-hidden="true">{initial}</div>
          {/* S4-04: tu nombre público (el de la mesa) con su etiqueta; si aún no hay, el de Google. */}
          <h1 className="profile-name">
            {stats?.publicName ?? label}
            {stats?.tag && <small className="profile-tag">#{stats.tag}</small>}
          </h1>
          {me.email && me.name && <p className="profile-email">{me.email}</p>}
          {since && <p className="profile-since">Jugando desde {since}</p>}
          <a className="profile-rank-link" href="#ranking">🏆 Ver el ranking</a>
        </header>

        {/* S4-02: tu división. S4-09: de la temporada en curso. */}
        <DivisionCard rating={stats?.rating ?? 1000} games={games} />
        {season && (
          <p className="season-line">
            Temporada <b>{season.name}</b> · termina el {season.ends}
          </p>
        )}
        {/* S5-05: torneos ganados. */}
        {trophies.length > 0 && (
          <section aria-labelledby="profile-trophies-title">
            <h2 id="profile-trophies-title" className="home-section">Tus torneos</h2>
            <ul className="profile-trophies">
              {[...trophies].reverse().map((t) => (
                <li key={t.torneoId}>
                  <span aria-hidden="true">🏆</span>
                  <span>
                    <b>Campeón · {t.name}</b>
                    <small>{new Date(t.at).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {season && season.badges.length > 0 && (
          <section aria-labelledby="profile-seasons-title">
            <h2 id="profile-seasons-title" className="home-section">Tus temporadas</h2>
            <ul className="season-badges">
              {[...season.badges].reverse().map((b) => (
                <li key={b.season}>
                  <DivisionBadge division={b.division} size={30} label />
                  <span>
                    <b>{divisionName(b.division)}</b>
                    <small>{b.name}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="profile-stats-title">
          <h2 id="profile-stats-title" className="home-section">Tus partidas</h2>
          {games > 0 ? (
            <div className="profile-stats">
              <Stat value={games} label={games === 1 ? 'jugada' : 'jugadas'} />
              <Stat value={wins} label={wins === 1 ? 'ganada' : 'ganadas'} tone="win" />
              <Stat value={losses} label={losses === 1 ? 'perdida' : 'perdidas'} tone="loss" />
              {pct !== null && <Stat value={`${pct} %`} label="de victorias" wide />}
              <StreakLine streak={stats?.streak ?? 0} best={stats?.bestStreak ?? 0} />
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

        {history && history.length > 0 && (
          <section aria-labelledby="profile-history-title">
            <h2 id="profile-history-title" className="home-section">Últimas partidas</h2>
            <ol className="profile-history">
              {history.map((r, i) => (
                <HistoryRow key={`${r.at}-${i}`} r={r} />
              ))}
            </ol>
          </section>
        )}

        {/* S4-03: de dónde eres. */}
        <section aria-labelledby="profile-place-title">
          <h2 id="profile-place-title" className="home-section">De dónde eres</h2>
          <PlacePicker />
        </section>

        {/* S5-02 */}
        <section aria-labelledby="profile-push-title">
          <h2 id="profile-push-title" className="home-section">Avisos</h2>
          <PushSettings />
        </section>

        <section className="profile-account" aria-labelledby="profile-account-title">
          <h2 id="profile-account-title" className="home-section">Cuenta</h2>
          <div className="profile-actions">
            <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
            <a href={apiUrl('/api/me/data')} download="guinote-mis-datos.json">Descargar mis datos</a>
            <a href="#privacidad">Privacidad: qué guardamos</a>
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

/** "Llevas 3 ganadas seguidas" + mejor racha. */
function StreakLine({ streak, best }: { streak: number; best: number }) {
  let now: string | null = null;
  if (streak >= 2) now = `🔥 Llevas ${streak} ganadas seguidas`;
  else if (streak <= -3) now = `Llevas ${-streak} perdidas seguidas. ¡La próxima cae!`;
  if (!now && best < 2) return null;
  return (
    <p className="profile-streak">
      {now && <span>{now}</span>}
      {best >= 2 && <span className="profile-best">Mejor racha: {best} ganadas seguidas</span>}
    </p>
  );
}

function names(list: { name: string; bot: boolean }[]): string {
  const n = list.map((p) => (p.bot ? `${p.name} (bot)` : p.name));
  return n.length === 2 ? `${n[0]} y ${n[1]}` : n.join(', ');
}

/** "hoy 13:20", "ayer 21:05", "12 oct". */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `hoy ${hm}`;
  if (diff === 1) return `ayer ${hm}`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function HistoryRow({ r }: { r: ResultRow }) {
  const label = r.abandoned ? 'Abandono' : r.won ? 'Ganada' : 'Perdida';
  const tone = r.won ? 'is-win' : 'is-loss';
  return (
    <li className={`history-row ${tone}`}>
      <span className="history-badge">{label}</span>
      <span className="history-who">
        {r.mate && (
          <span className="history-line">
            con <b>{r.mate.bot ? `${r.mate.name} (bot)` : r.mate.name}</b>
            {r.kind === 'pareja' && <span className="history-pair"> · tu pareja</span>}
          </span>
        )}
        <small>contra {names(r.rivals)}</small>
      </span>
      <span className="history-side">
        <b className={r.delta >= 0 ? 'is-up' : 'is-down'}>
          {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `−${-r.delta}` : '0'}
        </b>
        <small>{when(r.at)}</small>
      </span>
    </li>
  );
}

/** S4-02: división, puntos y lo que falta para la siguiente. */
function DivisionCard({ rating, games }: { rating: number; games: number }) {
  const division = divisionFor(rating, games);
  if (!division) {
    const left = PLACEMENT_GAMES - games;
    return (
      <div className="division-card is-unranked">
        <span className="division-placeholder" aria-hidden="true">?</span>
        <span className="division-info">
          <b>Sin clasificar</b>
          <small>
            Juega {left} {left === 1 ? 'partida online más' : 'partidas online más'} para tener división.
          </small>
          <span className="division-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${games / PLACEMENT_GAMES})` }} />
          </span>
        </span>
      </div>
    );
  }
  const next = nextDivision(rating);
  const cur = DIVISIONS.find((d) => d.id === division)!;
  // Progreso dentro de la división (Bronce no tiene suelo: contamos 150 bajo Plata).
  const nextMin = next ? DIVISIONS.find((d) => d.id === next.division)!.min : 0;
  const floor = Number.isFinite(cur.min) ? cur.min : nextMin - 150;
  const progress = next ? Math.max(0, Math.min(1, (rating - floor) / (nextMin - floor))) : 1;
  return (
    <div className="division-card">
      <DivisionBadge division={division} size={52} label />
      <span className="division-info">
        <b>{divisionName(division)}</b>
        <small>{Math.round(rating)} puntos</small>
        {next ? (
          <>
            <span className="division-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </span>
            <small>
              Te faltan {next.missing} para {divisionName(next.division)}
            </small>
          </>
        ) : (
          <small>Lo más alto. ¡Enhorabuena!</small>
        )}
      </span>
    </div>
  );
}
