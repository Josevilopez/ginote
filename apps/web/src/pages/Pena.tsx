import { useEffect, useState } from 'react';
import { DivisionBadge } from '../components/DivisionBadge.js';
import { useAccount } from '../account.js';
import { STATUS_LABEL, useFriends } from '../friends.js';
import { fetchPenaPreview, penaLink, usePena, type PenaMember, type PenaPreview, type PenaView } from '../penas.js';
import { GoogleButton } from './Friends.js';
import './Home.css';
import './Ranking.css';
import './Friends.css';
import './Pena.css';

/**
 * S5-03: "Mi peña" (`#pena`) y el enlace para entrar en una (`#pena-CODIGO`).
 */
export function Pena({ onBack, joinCode }: { onBack: () => void; joinCode: string | null }) {
  const { status, me, googleClientId, init } = useAccount();
  const { data, error, refresh, clearError } = usePena();

  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    if (!me) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [me, refresh]);
  useEffect(() => clearError, [clearError]);

  if (status !== 'ready') return null;

  return (
    <div className="home ranking friends pena">
      <div className="home-inner">
        <button type="button" className="profile-back" onClick={onBack}>
          <svg className="back-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Volver
        </button>

        {joinCode && <JoinCard code={joinCode} loggedIn={!!me} inPena={data?.pena ?? null} />}

        {!me ? (
          <>
            {!joinCode && <h1 className="ranking-title">Peñas</h1>}
            <div className="ranking-note">
              <p>Inicia sesión para entrar en una peña: tu cuadrilla, el bar, el pueblo… con su propio ranking.</p>
              <p className="friends-small">No hace falta para jugar. Solo usamos tu cuenta de Google para reconocerte.</p>
              {googleClientId && <GoogleButton clientId={googleClientId} />}
            </div>
          </>
        ) : data === undefined ? (
          <p className="ranking-loading">Cargando…</p>
        ) : data.pena ? (
          <MyPena pena={data.pena} />
        ) : (
          !joinCode && <NoPena />
        )}

        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Vista previa del enlace `#pena-CODIGO`. */
function JoinCard({ code, loggedIn, inPena }: { code: string; loggedIn: boolean; inPena: PenaView | null }) {
  const join = usePena((s) => s.join);
  const [preview, setPreview] = useState<PenaPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetchPenaPreview(code).then(setPreview);
  }, [code]);

  if (preview === undefined) return <p className="ranking-loading">Cargando…</p>;
  if (preview === null) return <p className="ranking-note">Ese enlace de peña ya no vale. Pide uno nuevo.</p>;
  if (inPena && inPena.code === code) return null; // ya estás dentro: se ve tu peña debajo

  return (
    <section className="pena-join" aria-labelledby="pena-join-title">
      <span className="pena-kicker">Te invitan a la peña</span>
      <h1 id="pena-join-title">{preview.name}</h1>
      <p>
        {preview.placeName ? `${preview.placeName} · ` : ''}
        {preview.members === 1 ? '1 miembro' : `${preview.members} miembros`}
      </p>
      {loggedIn && !inPena && (
        <button
          type="button"
          className="home-choice is-main"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void join(code).then((ok) => {
              setBusy(false);
              if (ok) history.replaceState(null, '', '#pena');
            });
          }}
        >
          <b>Entrar en la peña</b>
        </button>
      )}
      {loggedIn && inPena && <p className="friends-small">Ya estás en la peña «{inPena.name}». Para entrar en esta, primero sal de la tuya.</p>}
    </section>
  );
}

function NoPena() {
  const { data, create, accept, decline } = usePena();
  const place = useAccount((s) => s.place);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const invites = data?.invites ?? [];

  return (
    <>
      <h1 className="ranking-title">Peñas</h1>
      <p className="friends-small pena-intro">
        Una peña es tu grupo: la cuadrilla, los del bar, los del pueblo. Tiene su propio ranking y veis quién está conectado para echar
        una partida.
      </p>

      {invites.length > 0 && (
        <section aria-labelledby="pena-inv-title">
          <h2 id="pena-inv-title" className="friends-h2">
            Te han invitado
          </h2>
          <ul className="ranking-list">
            {invites.map((i) => (
              <li key={i.id} className="ranking-row pena-invite">
                <span className="ranking-name">
                  {i.name}
                  <small>
                    {' '}
                    · {i.placeName ? `${i.placeName} · ` : ''}
                    {i.members === 1 ? '1 miembro' : `${i.members} miembros`}
                  </small>
                </span>
                <span className="friends-actions">
                  <button type="button" className="friends-yes" onClick={() => void accept(i.id)}>
                    Unirme
                  </button>
                  <button type="button" className="friends-no" onClick={() => void decline(i.id)}>
                    No
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="friends-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || name.trim().length < 3) return;
          setBusy(true);
          void create(name.trim()).then(() => setBusy(false));
        }}
      >
        <label htmlFor="pena-name">Crea tu peña</label>
        <div>
          <input
            id="pena-name"
            type="text"
            autoComplete="off"
            maxLength={30}
            placeholder="Los del Casino"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={busy || name.trim().length < 3}>
            Crear
          </button>
        </div>
        <small>
          {place?.municipioName
            ? `Será una peña de ${place.municipioName}. Después invitas a tus amigos o les pasas el enlace.`
            : 'Después invitas a tus amigos o les pasas el enlace. Si pones tu pueblo en tu perfil, la peña será de allí.'}
        </small>
      </form>
      <p className="friends-small">¿Te han pasado el enlace de una peña? Ábrelo y podrás entrar.</p>
    </>
  );
}

type Tab = 'season' | 'week';

function MyPena({ pena }: { pena: PenaView }) {
  const { kick, leave } = usePena();
  const [tab, setTab] = useState<Tab>('season');
  const [copied, setCopied] = useState(false);
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const share = async () => {
    const url = penaLink(pena.code);
    try {
      if (navigator.share) {
        await navigator.share({ title: pena.name, text: `Entra en la peña «${pena.name}» del guiñote`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelado.
    }
  };

  const rows =
    tab === 'season'
      ? [...pena.members].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'es'))
      : [...pena.members].sort((a, b) => b.weekPoints - a.weekPoints || b.weekGames - a.weekGames || a.name.localeCompare(b.name, 'es'));
  const online = pena.members.filter((m) => !m.you && m.status !== 'offline').length;

  return (
    <>
      <header className="pena-head">
        <span className="pena-kicker">Tu peña</span>
        <h1 className="ranking-title">{pena.name}</h1>
        <p>
          {pena.placeName ? `${pena.placeName} · ` : ''}
          {pena.members.length === 1 ? '1 miembro' : `${pena.members.length} miembros`}
          {online > 0 && <span className="pena-online"> · {online === 1 ? '1 conectado' : `${online} conectados`}</span>}
        </p>
        <button type="button" className="friends-share" onClick={() => void share()}>
          {copied ? '¡Enlace copiado!' : 'Compartir enlace de la peña'}
        </button>
      </header>

      <InviteToPena pena={pena} />

      <section aria-labelledby="pena-rank-title">
        <h2 id="pena-rank-title" className="friends-h2">
          Ranking de la peña
        </h2>
        <div className="ranking-tabs pena-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'season'} className={tab === 'season' ? 'is-on' : ''} onClick={() => setTab('season')}>
            Temporada
          </button>
          <button type="button" role="tab" aria-selected={tab === 'week'} className={tab === 'week' ? 'is-on' : ''} onClick={() => setTab('week')}>
            Esta semana
          </button>
        </div>
        <ol className="ranking-list">
          {rows.map((m, i) => (
            <li key={m.id} className={`ranking-row pena-row ${m.you ? 'is-you' : ''}`}>
              <span className="ranking-pos">{i + 1}</span>
              <span className={`friends-dot is-${m.status}`} aria-hidden="true" />
              {m.division ? <DivisionBadge division={m.division} size={20} /> : <span className="ranking-nobadge" />}
              <span className="ranking-name">
                {m.name}
                {m.tag && <small>#{m.tag}</small>}
                {m.you && <em> (tú)</em>}
                <span className={`friends-status is-${m.status}`}>
                  {m.you ? (m.owner ? 'Llevas la peña' : '') : STATUS_LABEL[m.status]}
                  {!m.you && m.owner && ' · lleva la peña'}
                </span>
              </span>
              <Points m={m} tab={tab} />
              {pena.youAreOwner && !m.you ? (
                confirmKick === m.id ? (
                  <span className="pena-kick-confirm">
                    <button type="button" className="friends-no is-danger" onClick={() => void kick(m.id).then(() => setConfirmKick(null))}>
                      Expulsar
                    </button>
                    <button type="button" className="friends-no" onClick={() => setConfirmKick(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" className="friends-more" aria-label={`Expulsar a ${m.name}`} title="Expulsar" onClick={() => setConfirmKick(m.id)}>
                    ✕
                  </button>
                )
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
        <p className="friends-small">
          {tab === 'season'
            ? 'Por nivel de la temporada. El escudo aparece tras 10 partidas online.'
            : 'Puntos de nivel ganados desde el lunes.'}{' '}
          Para jugar con alguien conectado, crea una pareja o una mesa privada y pulsa "Invitar".
        </p>
      </section>

      <div className="pena-leave">
        {!confirmLeave ? (
          <button type="button" className="friends-no" onClick={() => setConfirmLeave(true)}>
            Salir de la peña
          </button>
        ) : (
          <div className="profile-confirm" role="alert">
            <p>
              {pena.members.length === 1
                ? 'Eres el único miembro: la peña se borrará.'
                : pena.youAreOwner
                  ? 'Llevas la peña: pasará al miembro más antiguo.'
                  : '¿Seguro que quieres salir?'}
            </p>
            <div>
              <button type="button" onClick={() => setConfirmLeave(false)}>
                Cancelar
              </button>
              <button type="button" className="is-danger" onClick={() => void leave()}>
                Sí, salir
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Points({ m, tab }: { m: PenaMember; tab: Tab }) {
  if (tab === 'season') return <span className="ranking-points">{m.rating}</span>;
  const p = m.weekPoints;
  return <span className={`ranking-points ${p < 0 ? 'is-neg' : ''}`}>{m.weekGames === 0 ? '—' : p > 0 ? `+${p}` : p < 0 ? `−${-p}` : '0'}</span>;
}

/** Amigos que aún no están en la peña: botón "Invitar" (les llega aviso). */
function InviteToPena({ pena }: { pena: PenaView }) {
  const friends = useFriends((s) => s.data?.friends);
  const refreshFriends = useFriends((s) => s.refresh);
  const invite = usePena((s) => s.invite);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void refreshFriends();
  }, [refreshFriends]);

  const ids = new Set(pena.members.map((m) => m.id));
  const candidates = (friends ?? []).filter((f) => !ids.has(f.id));
  if (candidates.length === 0) return null;

  return (
    <section className="invite-friends pena-invite-friends">
      <button type="button" className="pena-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Invitar a amigos ({candidates.length}) <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul>
          {candidates.map((f) => (
            <li key={f.id}>
              <span className={`friends-dot is-${f.status}`} aria-hidden="true" />
              <span>{f.name}</span>
              <button
                type="button"
                disabled={!!sent[f.id]}
                onClick={() =>
                  void invite(f.id).then((err) => setSent((s) => ({ ...s, [f.id]: err ?? 'Invitado ✓' })))
                }
              >
                {sent[f.id] ?? 'Invitar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
