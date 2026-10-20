import { useEffect, useState } from 'react';
import { useAccount } from '../account.js';
import { useFriends } from '../friends.js';
import '../pages/Friends.css';

/**
 * S5-01: "Invita a un amigo" con los que están conectados. Se usa en la
 * pantalla de pareja (kind `pareja`) y en la sala de una mesa privada
 * (kind `mesa`). Sin cuenta o sin amigos conectados no se pinta nada.
 */
export function InviteFriends({ kind, code }: { kind: 'pareja' | 'mesa'; code: string }) {
  const me = useAccount((s) => s.me);
  const data = useFriends((s) => s.data);
  const refresh = useFriends((s) => s.refresh);
  const invite = useFriends((s) => s.invite);
  const [sent, setSent] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me) void refresh();
  }, [me, refresh]);

  if (!me || !data) return null;
  // S5-03: amigos y gente de tu peña.
  const everyone = [...data.friends, ...(data.mates ?? [])];
  const online = everyone.filter((f) => f.status === 'online');
  if (online.length === 0) {
    return everyone.length > 0 ? <p className="invite-friends-none">Ningún amigo conectado ahora mismo.</p> : null;
  }

  const send = async (id: string) => {
    setError(null);
    const err = await invite(id, kind, code);
    if (err) setError(err);
    else setSent((s) => ({ ...s, [id]: true }));
  };

  return (
    <div className="invite-friends">
      <h2>Invita a un amigo conectado</h2>
      <ul>
        {online.map((f) => (
          <li key={f.id}>
            <span className="friends-dot is-online" aria-hidden="true" />
            <span>{f.name}</span>
            <button type="button" disabled={!!sent[f.id]} onClick={() => void send(f.id)}>
              {sent[f.id] ? 'Invitado ✓' : 'Invitar'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
