import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '../account.js';
import { useFriends } from '../friends.js';
import { useGame } from '../store.js';
import {
  createTorneo,
  dateLabel,
  fetchTorneo,
  fetchTorneos,
  playTorneo,
  torneoAction,
  type TorneoDetail,
  type TorneoSummary,
} from '../torneos.js';
import { GoogleButton } from './Friends.js';
import './Home.css';
import './Ranking.css';
import './Friends.css';
import '../components/Retos.css';
import './Torneos.css';
import { shouldPoll } from '../idle.js';

const BACK_ARROW = (
  <svg className="back-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
    <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** S5-05: torneos (`#torneos`) y un torneo (`#torneo-<id>`). */
export function Torneos({ id, onBack }: { id: string | null; onBack: () => void }) {
  const init = useAccount((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  return (
    <div className="home ranking friends torneos">
      <div className="home-inner">
        <button type="button" className="profile-back" onClick={onBack}>
          {BACK_ARROW} Volver
        </button>
        {id ? <Detail id={id} /> : <List />}
      </div>
    </div>
  );
}

const STATUS: Record<TorneoSummary['status'], string> = {
  open: 'Inscripción abierta',
  running: 'En juego',
  finished: 'Terminado',
  cancelled: 'Cancelado',
};

function List() {
  const [data, setData] = useState<{ canCreate: boolean; torneos: TorneoSummary[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    void fetchTorneos().then((r) => (r.ok ? setData(r.data) : setFailed(true)));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <h1 className="ranking-title">Torneos</h1>
      <p className="friends-small">Torneos de parejas por eliminatorias. Os apuntáis con un amigo y cada ronda tenéis unos días para jugar vuestro cruce.</p>
      {failed && <p className="ranking-note">No se han podido cargar los torneos.</p>}
      {data && data.torneos.length === 0 && <p className="ranking-note">Ahora mismo no hay torneos. ¡Pronto habrá!</p>}
      {data && (
        <ul className="torneo-list">
          {data.torneos.map((t) => (
            <li key={t.id}>
              <a href={`#torneo-${t.id}`} className={`torneo-item is-${t.status}`}>
                <span className="torneo-status">{STATUS[t.status]}</span>
                <b>{t.name}</b>
                <small>
                  {t.status === 'open'
                    ? `${t.pairs} de ${t.size} parejas · hasta el ${dateLabel(t.signupUntil)}`
                    : t.status === 'finished' && t.champion
                      ? `🏆 ${t.champion}`
                      : `${t.pairs} parejas`}
                </small>
                {t.my && <span className="torneo-mine">{t.my.status === 'invited' ? 'Te han apuntado' : 'Juegas'}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {data?.canCreate &&
        (creating ? (
          <CreateForm
            onDone={() => {
              setCreating(false);
              load();
            }}
          />
        ) : (
          <button type="button" className="retos-new torneo-create" onClick={() => setCreating(true)}>
            + Crear torneo
          </button>
        ))}
    </>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const inAWeek = new Date(Date.now() + 7 * 86_400_000);
  inAWeek.setHours(21, 0, 0, 0);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [name, setName] = useState('');
  const [size, setSize] = useState(8);
  const [partidas, setPartidas] = useState(3);
  const [roundDays, setRoundDays] = useState(2);
  const [until, setUntil] = useState(local(inAWeek));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="reto-new-panel torneo-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void createTorneo({ name, size, partidas, roundDays, signupUntil: new Date(until).toISOString() }).then((r) => {
          setBusy(false);
          if (r.ok) onDone();
          else setError(r.error);
        });
      }}
    >
      <label>
        Nombre
        <input value={name} maxLength={40} placeholder="Torneo de Navidad" onChange={(e) => setName(e.target.value)} />
      </label>
      <Choice label="Parejas" value={size} options={[8, 16]} onChange={setSize} />
      <Choice label="Partidas por cruce" value={partidas} options={[1, 3]} onChange={setPartidas} render={(n) => (n === 1 ? 'A 1 partida' : 'Al mejor de 3')} />
      <Choice label="Días por ronda" value={roundDays} options={[1, 2, 3, 7]} onChange={setRoundDays} />
      <label>
        Fin de la inscripción
        <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      {error && <p className="home-error" role="alert">{error}</p>}
      <button type="submit" className="friends-share" disabled={busy || name.trim().length < 3}>
        Crear torneo
      </button>
      <button type="button" className="friends-no reto-cancel" onClick={onDone}>
        Cancelar
      </button>
    </form>
  );
}

function Choice({ label, value, options, onChange, render }: { label: string; value: number; options: number[]; onChange: (n: number) => void; render?: (n: number) => string }) {
  return (
    <div className="torneo-choice" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <div className="reto-games" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'is-on' : ''} onClick={() => onChange(o)}>
            {render ? render(o) : o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const { me, googleClientId } = useAccount();
  const [t, setT] = useState<TorneoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void fetchTorneo(id).then((r) => (r.ok ? setT(r.data) : setError(r.error)));
  }, [id]);
  useEffect(() => {
    load();
    const iv = window.setInterval(() => shouldPoll() && load(), 20_000);
    return () => window.clearInterval(iv);
  }, [load, me]);

  const act = async (p: Promise<{ ok: true; data: TorneoDetail } | { ok: false; error: string }>) => {
    setBusy(true);
    setError(null);
    const r = await p;
    setBusy(false);
    if (r.ok) setT(r.data);
    else setError(r.error);
  };

  if (!t) return error ? <p className="ranking-note">{error}</p> : <p className="ranking-loading">Cargando…</p>;

  return (
    <>
      <header className="torneo-head">
        <span className="pena-kicker">{STATUS[t.status]}</span>
        <h1 className="ranking-title">{t.name}</h1>
        <p>
          {t.status === 'open' ? `${t.pairs} de ${t.size} parejas` : `${t.pairs} parejas`} · {t.partidas === 1 ? 'cruces a 1 partida' : 'cruces al mejor de 3'} ·{' '}
          {t.roundDays === 1 ? '1 día' : `${t.roundDays} días`} por ronda
        </p>
        {t.status === 'open' && <p>Inscripción hasta el {dateLabel(t.signupUntil)}.</p>}
      </header>

      {t.status === 'finished' && t.champion && (
        <div className="torneo-champion">
          <span aria-hidden="true">🏆</span>
          <div>
            <small>Campeones</small>
            <b>{t.champion}</b>
          </div>
        </div>
      )}

      {!me && t.status === 'open' && (
        <div className="ranking-note">
          <p>Inicia sesión para apuntarte con un amigo.</p>
          {googleClientId && <GoogleButton clientId={googleClientId} />}
        </div>
      )}

      {me && t.status === 'open' && <SignupCard t={t} busy={busy} act={act} />}
      {me && t.status === 'running' && t.next && <NextMatch t={t} onError={setError} />}
      {me && t.status === 'running' && t.eliminated && <p className="ranking-note">Os han eliminado. ¡A por el próximo torneo!</p>}

      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}

      {t.status === 'open' && (
        <section aria-labelledby="torneo-pairs">
          <h2 id="torneo-pairs" className="friends-h2">
            Parejas apuntadas
          </h2>
          {t.entries.filter((e) => e.confirmed).length === 0 ? (
            <p className="friends-small">Aún no hay ninguna. ¡Sed los primeros!</p>
          ) : (
            <ul className="torneo-pairs">
              {t.entries
                .filter((e) => e.confirmed)
                .map((e) => (
                  <li key={e.id} className={e.you ? 'is-you' : ''}>
                    {e.names}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {t.rounds.length > 0 && <Bracket t={t} />}

      {t.isAdmin && (t.status === 'open' || t.status === 'running') && (
        <div className="torneo-admin">
          {t.status === 'open' && (
            <button type="button" className="friends-yes" disabled={busy} onClick={() => void act(torneoAction(t.id, 'start'))}>
              Empezar ya
            </button>
          )}
          <button type="button" className="friends-no is-danger" disabled={busy} onClick={() => void act(torneoAction(t.id, 'cancel'))}>
            Cancelar torneo
          </button>
        </div>
      )}
    </>
  );
}

type Act = (p: Promise<{ ok: true; data: TorneoDetail } | { ok: false; error: string }>) => Promise<void>;

function SignupCard({ t, busy, act }: { t: TorneoDetail; busy: boolean; act: Act }) {
  const friends = useFriends((s) => s.data?.friends);
  const refresh = useFriends((s) => s.refresh);
  const [partner, setPartner] = useState('');
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (t.my?.status === 'in')
    return (
      <div className="reto-card is-active torneo-my">
        <p>
          ✅ Estáis dentro: <b>tú y {t.my.partner}</b>. Cuando cierre la inscripción os avisamos de vuestro primer cruce.
        </p>
        <button type="button" className="friends-no" disabled={busy} onClick={() => void act(torneoAction(t.id, 'withdraw'))}>
          Borrarnos
        </button>
      </div>
    );
  if (t.my?.status === 'waiting')
    return (
      <div className="reto-card is-pending torneo-my">
        <p>
          Has apuntado a <b>{t.my.partner}</b>. Falta que confirme.
        </p>
        <button type="button" className="friends-no" disabled={busy} onClick={() => void act(torneoAction(t.id, 'withdraw'))}>
          Borrarnos
        </button>
      </div>
    );
  if (t.my?.status === 'invited')
    return (
      <div className="reto-card is-pending torneo-my">
        <p>
          <b>{t.my.partner}</b> te ha apuntado de pareja. ¿Jugáis?
        </p>
        <div className="reto-actions">
          <button type="button" className="friends-yes" disabled={busy} onClick={() => void act(torneoAction(t.id, 'confirm'))}>
            Sí, jugamos
          </button>
          <button type="button" className="friends-no" disabled={busy} onClick={() => void act(torneoAction(t.id, 'withdraw'))}>
            No
          </button>
        </div>
      </div>
    );
  if (t.pairs >= t.size) return <p className="ranking-note">El torneo está completo.</p>;
  if (!friends || friends.length === 0)
    return (
      <p className="ranking-note">
        Para apuntarte necesitas una pareja de tus <a href="#amigos">amigos</a>.
      </p>
    );
  return (
    <form
      className="reto-new-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (partner) void act(torneoAction(t.id, 'signup', { partnerId: partner }));
      }}
    >
      <label htmlFor="torneo-partner">¿Con quién jugáis?</label>
      <select id="torneo-partner" value={partner} onChange={(e) => setPartner(e.target.value)} className="torneo-select">
        <option value="">Elige a tu pareja</option>
        {friends.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.tag ? ` #${f.tag}` : ''}
          </option>
        ))}
      </select>
      <button type="submit" className="friends-share" disabled={busy || !partner}>
        Apuntarnos
      </button>
      <small className="friends-small">Le llegará un aviso para que confirme.</small>
    </form>
  );
}

function NextMatch({ t, onError }: { t: TorneoDetail; onError: (e: string) => void }) {
  const joinReserved = useGame((s) => s.joinReserved);
  const [busy, setBusy] = useState(false);
  const n = t.next!;
  return (
    <div className="reto-card is-active torneo-next">
      <span className="pena-kicker">{n.round}</span>
      <p>
        Os toca contra <b>{n.rival}</b>.
      </p>
      <p className="friends-small">
        Tenéis hasta el {dateLabel(n.deadline)}. Entrad los cuatro a la mesa y empieza sola. Si el otro equipo no aparece antes del plazo, pasáis vosotros.
      </p>
      <button
        type="button"
        className="home-choice is-main"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void playTorneo(t.id).then((r) => {
            setBusy(false);
            if (r.ok) joinReserved(r.data.code, r.data.token);
            else onError(r.error);
          });
        }}
      >
        <b>{n.live ? 'Volver a la mesa' : 'Ir a la mesa'}</b>
      </button>
    </div>
  );
}

const RESULT: Record<string, string> = { bye: 'pasa directo', walkover: 'pasa porque el rival no se presentó', sorteo: 'nadie jugó: pasa por sorteo' };

function Bracket({ t }: { t: TorneoDetail }) {
  return (
    <section className="torneo-bracket" aria-label="Cuadro">
      {t.rounds.map((r, i) => (
        <div key={i} className="torneo-round">
          <h2 className="friends-h2">
            {r.name}
            {r.deadline && t.status === 'running' && <small> · hasta el {dateLabel(r.deadline)}</small>}
          </h2>
          <ul>
            {r.matches
              .filter((m) => m.a || m.b || i > 0)
              .map((m) => (
                <li key={m.id} className="torneo-match">
                  {m.result === 'bye' ? (
                    <Side p={m.a ?? m.b} win score={undefined} note="pasa directo" />
                  ) : (
                    <>
                      <Side p={m.a} win={!!m.winner && m.winner === m.a?.id} score={m.score?.[0]} />
                      <Side p={m.b} win={!!m.winner && m.winner === m.b?.id} score={m.score?.[1]} />
                      {m.result && m.result !== 'played' && <small className="torneo-note">{RESULT[m.result]}</small>}
                    </>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Side({ p, win, score, note }: { p: { names: string; you: boolean } | null; win: boolean; score: number | undefined; note?: string }) {
  return (
    <div className={`torneo-side ${win ? 'is-win' : ''} ${p?.you ? 'is-you' : ''}`}>
      <span>{p ? p.names : 'Por decidir'}</span>
      {score !== undefined && <b>{score}</b>}
      {note && <small>{note}</small>}
    </div>
  );
}
