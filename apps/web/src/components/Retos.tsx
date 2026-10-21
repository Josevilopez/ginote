import { useEffect, useState } from 'react';
import { searchPenas, usePena, type PenaSearchResult, type PenaView, type RetoView } from '../penas.js';
import './Retos.css';

const GAMES = [5, 10, 20] as const;
const DAY = 86_400_000;

function daysLeft(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'termina ya';
  const d = Math.ceil(ms / DAY);
  return d === 1 ? 'queda 1 día' : `quedan ${d} días`;
}

function expiresText(iso: string | null): string {
  if (!iso) return '';
  const d = Math.ceil((Date.parse(iso) - Date.now()) / DAY);
  return d <= 1 ? 'caduca en 1 día' : `caduca en ${d} días`;
}

/**
 * S5-04: retos de la peña. Los abiertos (en juego y propuestos), los 3
 * últimos terminados y, para quien lleva la peña, "Retar a otra peña".
 */
export function Retos({ pena }: { pena: PenaView }) {
  const retos = pena.retos ?? [];
  const [open, setOpen] = useState(false);
  const active = retos.filter((r) => r.status === 'active');
  const pending = retos.filter((r) => r.status === 'pending');
  const done = retos.filter((r) => r.status === 'finished');

  if (retos.length === 0 && !pena.youAreOwner) return null;

  return (
    <section className="retos" aria-labelledby="retos-title">
      <h2 id="retos-title" className="friends-h2">
        Retos
      </h2>
      {retos.length === 0 && (
        <p className="friends-small">Reta a otra peña a 5, 10 o 20 partidas en una semana. Gana la que más partidas se lleve.</p>
      )}
      {active.map((r) => (
        <ActiveCard key={r.id} r={r} myName={pena.name} />
      ))}
      {pending.map((r) => (
        <PendingCard key={r.id} r={r} owner={pena.youAreOwner} />
      ))}
      {done.length > 0 && (
        <ul className="retos-done">
          {done.map((r) => (
            <li key={r.id} className={`is-${r.result}`}>
              <span>{r.result === 'win' ? '🏆 Ganado' : r.result === 'lose' ? 'Perdido' : 'Empate'}</span>
              <b>
                {r.us}–{r.them}
              </b>
              <span>contra {r.rivalName}</span>
            </li>
          ))}
        </ul>
      )}
      {pena.youAreOwner &&
        (open ? (
          <Challenge onClose={() => setOpen(false)} />
        ) : (
          <button type="button" className="retos-new" onClick={() => setOpen(true)}>
            ⚔️ Retar a otra peña
          </button>
        ))}
      {(active.length > 0 || pending.length > 0) && (
        <p className="friends-small">
          Cuentan las partidas online en las que en una pareja solo hay gente de una peña y en la otra solo de la otra (los huecos pueden
          ser bots; también en mesas privadas).
        </p>
      )}
    </section>
  );
}

function ActiveCard({ r, myName }: { r: RetoView; myName: string }) {
  const played = r.us + r.them;
  const pctUs = played === 0 ? 50 : (r.us / played) * 100;
  return (
    <div className="reto-card is-active">
      <div className="reto-score" aria-label={`${myName} ${r.us}, ${r.rivalName} ${r.them}`}>
        <span className="reto-team">{myName}</span>
        <b>
          {r.us} – {r.them}
        </b>
        <span className="reto-team is-rival">{r.rivalName}</span>
      </div>
      <div className="reto-bar" aria-hidden="true">
        <span style={{ width: `${pctUs}%` }} />
      </div>
      <p>
        {played} de {r.games} partidas · {daysLeft(r.endsAt)}
      </p>
    </div>
  );
}

function PendingCard({ r, owner }: { r: RetoView; owner: boolean }) {
  const answer = usePena((s) => s.answer);
  const [busy, setBusy] = useState(false);
  const act = (a: 'accept' | 'decline' | 'cancel') => {
    setBusy(true);
    void answer(r.id, a).then(() => setBusy(false));
  };
  return (
    <div className="reto-card is-pending">
      {r.weChallenged ? (
        <p>
          Habéis retado a <b>{r.rivalName}</b> a {r.games} partidas. Esperando respuesta ({expiresText(r.expiresAt)}).
        </p>
      ) : (
        <p>
          <b>{r.rivalName}</b> os reta a {r.games} partidas en una semana.
          {!owner && ' Lo acepta quien lleva la peña.'}
        </p>
      )}
      {owner && (
        <div className="reto-actions">
          {r.weChallenged ? (
            <button type="button" className="friends-no" disabled={busy} onClick={() => act('cancel')}>
              Cancelar reto
            </button>
          ) : (
            <>
              <button type="button" className="friends-yes" disabled={busy} onClick={() => act('accept')}>
                Aceptar el reto
              </button>
              <button type="button" className="friends-no" disabled={busy} onClick={() => act('decline')}>
                No
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Challenge({ onClose }: { onClose: () => void }) {
  const propose = usePena((s) => s.propose);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PenaSearchResult[] | null>(null);
  const [picked, setPicked] = useState<PenaSearchResult | null>(null);
  const [games, setGames] = useState<number>(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    const id = window.setTimeout(() => {
      void searchPenas(q.trim()).then((r) => alive && setResults(r));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [q, picked]);

  return (
    <div className="reto-new-panel">
      {!picked ? (
        <>
          <label htmlFor="reto-q">¿A qué peña retáis?</label>
          <input id="reto-q" type="search" autoComplete="off" placeholder="Nombre de la peña" value={q} onChange={(e) => setQ(e.target.value)} />
          {results && results.length === 0 && <p className="friends-small">No hay ninguna peña con ese nombre.</p>}
          {results && results.length > 0 && (
            <ul className="reto-results">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setPicked(p)}>
                    <b>{p.name}</b>
                    <small>
                      {p.placeName ? `${p.placeName} · ` : ''}
                      {p.members === 1 ? '1 miembro' : `${p.members} miembros`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p>
            Retar a <b>{picked.name}</b> a…
          </p>
          <div className="reto-games" role="radiogroup" aria-label="Partidas">
            {GAMES.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={games === g} className={games === g ? 'is-on' : ''} onClick={() => setGames(g)}>
                {g} partidas
              </button>
            ))}
          </div>
          <p className="friends-small">Tienen 3 días para aceptar. Después, una semana para jugarlas.</p>
          <button
            type="button"
            className="friends-share"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void propose(picked.id, games).then((ok) => {
                setBusy(false);
                if (ok) onClose();
              });
            }}
          >
            Enviar reto
          </button>
        </>
      )}
      <button type="button" className="friends-no reto-cancel" onClick={picked ? () => setPicked(null) : onClose}>
        {picked ? 'Elegir otra peña' : 'Cancelar'}
      </button>
    </div>
  );
}
