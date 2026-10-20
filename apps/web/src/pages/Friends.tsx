import { useEffect, useRef, useState } from 'react';
import { DivisionBadge } from '../components/DivisionBadge.js';
import { renderGoogleButton, useAccount } from '../account.js';
import { STATUS_LABEL, friendCode, friendLink, useFriends, type Friend } from '../friends.js';
import './Home.css';
import './Ranking.css';
import './Friends.css';

/**
 * S5-01: "Amigos" (`#amigos`, o `#amigos/Nombre%231234` para añadir con
 * un enlace). Tu código para compartir, añadir por código, solicitudes
 * recibidas y tu lista con quién está conectado.
 */
export function Friends({ onBack, prefill }: { onBack: () => void; prefill: string | null }) {
  const { status, me, googleClientId, init } = useAccount();
  const { data, refresh, request, accept, remove } = useFriends();
  const [code, setCode] = useState(prefill ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    if (me) void refresh();
  }, [me, refresh]);
  // En esta pantalla, más a menudo que el sondeo general.
  useEffect(() => {
    if (!me) return;
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [me, refresh]);

  if (status !== 'ready') return null;

  if (!me) {
    return (
      <div className="home ranking friends">
        <div className="home-inner">
          <BackButton onBack={onBack} />
          <h1 className="ranking-title">Amigos</h1>
          <div className="ranking-note">
            <p>Inicia sesión para tener amigos: verás quién está conectado y podrás invitarle a jugar con un toque.</p>
            <p className="friends-small">No hace falta para jugar. Solo usamos tu cuenta de Google para reconocerte.</p>
            {googleClientId && <GoogleButton clientId={googleClientId} />}
          </div>
        </div>
      </div>
    );
  }

  const mine = data ? friendCode(data.me) : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    const r = await request(code.trim());
    setBusy(false);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setCode('');
  };

  const share = async () => {
    if (!mine) return;
    const url = friendLink(mine);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Guiñote', text: `Añádeme de amigo en el guiñote: ${mine}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelado: el código sigue a la vista.
    }
  };

  return (
    <div className="home ranking friends">
      <div className="home-inner">
        <BackButton onBack={onBack} />
        <h1 className="ranking-title">Amigos</h1>

        <section className="friends-mine" aria-label="Tu código">
          <span>Tu código</span>
          <b>{mine ?? '…'}</b>
          <button type="button" className="friends-share" onClick={() => void share()} disabled={!mine}>
            {copied ? '¡Enlace copiado!' : 'Compartir'}
          </button>
        </section>

        <form className="friends-add" onSubmit={(e) => void add(e)}>
          <label htmlFor="friends-code">Añadir a un amigo</label>
          <div>
            <input
              id="friends-code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              placeholder="Pilar#1234"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setMsg(null);
              }}
            />
            <button type="submit" disabled={busy || !code.trim()}>
              Añadir
            </button>
          </div>
          <small>Pídele su código: lo ve aquí mismo, en su pantalla de Amigos.</small>
          {msg && (
            <p className={`friends-msg ${msg.ok ? 'is-ok' : 'is-err'}`} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </p>
          )}
        </form>

        {data && data.incoming.length > 0 && (
          <section aria-labelledby="friends-in-title">
            <h2 id="friends-in-title" className="friends-h2">
              Quieren ser tus amigos
            </h2>
            <ul className="ranking-list">
              {data.incoming.map((f) => (
                <li key={f.id} className="ranking-row friends-row">
                  <Who f={f} />
                  <span className="friends-actions">
                    <button type="button" className="friends-yes" onClick={() => void accept(f.id)}>
                      Aceptar
                    </button>
                    <button type="button" className="friends-no" onClick={() => void remove(f.id, 'reject')}>
                      No
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="friends-list-title">
          <h2 id="friends-list-title" className="friends-h2">
            Tus amigos {data && data.friends.length > 0 && <small>({data.friends.filter((f) => f.status !== 'offline').length} conectados)</small>}
          </h2>
          {!data ? (
            <p className="ranking-loading">Cargando…</p>
          ) : data.friends.length === 0 ? (
            <p className="ranking-note">Aún no tienes amigos aquí. Comparte tu código o añade el de alguien.</p>
          ) : (
            <ul className="ranking-list">
              {data.friends.map((f) => (
                <li key={f.id} className="ranking-row friends-row">
                  <Who f={f} showStatus />
                  <span className="friends-actions">
                    {confirmRemove === f.id ? (
                      <>
                        <button type="button" className="friends-no is-danger" onClick={() => void remove(f.id, 'delete').then(() => setConfirmRemove(null))}>
                          Quitar
                        </button>
                        <button type="button" className="friends-no" onClick={() => setConfirmRemove(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="friends-more"
                        aria-label={`Quitar a ${f.name} de amigos`}
                        title="Quitar de amigos"
                        onClick={() => setConfirmRemove(f.id)}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data && data.friends.some((f) => f.status === 'online') && (
            <p className="friends-small">Para jugar con un amigo conectado, crea una pareja o una mesa privada desde la portada y pulsa "Invitar".</p>
          )}
        </section>

        {data && data.outgoing.length > 0 && (
          <section aria-labelledby="friends-out-title">
            <h2 id="friends-out-title" className="friends-h2">
              Esperando respuesta
            </h2>
            <ul className="ranking-list">
              {data.outgoing.map((f) => (
                <li key={f.id} className="ranking-row friends-row is-pending">
                  <Who f={f} />
                  <span className="friends-actions">
                    <button type="button" className="friends-no" onClick={() => void remove(f.id, 'reject')}>
                      Cancelar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="profile-back" onClick={onBack}>
      <svg className="back-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> Volver
    </button>
  );
}

export function Who({ f, showStatus = false }: { f: Friend; showStatus?: boolean }) {
  return (
    <>
      <span className={`friends-dot is-${showStatus ? f.status : 'none'}`} aria-hidden="true" />
      {f.division ? <DivisionBadge division={f.division} size={20} /> : <span className="ranking-nobadge" />}
      <span className="ranking-name">
        {f.name}
        {f.tag && <small>#{f.tag}</small>}
        {showStatus && <span className={`friends-status is-${f.status}`}>{STATUS_LABEL[f.status]}</span>}
      </span>
    </>
  );
}

export function GoogleButton({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    renderGoogleButton(ref.current, clientId, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es' }).catch(
      () => undefined,
    );
  }, [clientId]);
  return <div ref={ref} className="friends-gsi" />;
}
