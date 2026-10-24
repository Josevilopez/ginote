import { useState, useEffect, useRef } from 'react';
import { useGame, getPlayerName, setPlayerName } from '../store.js';
import { AccountBar, AccountHint } from '../components/AccountBar.js';
import { WelcomeSheet } from '../components/WelcomeSheet.js';
import { useAccount } from '../account.js';
import { isOffensiveName } from '@guinote/protocol';
import { useParty } from '../party.js';
import { useFriends } from '../friends.js';
import { usePena } from '../penas.js';
import { PAGE_PRIVACY, PAGE_RULES, linkTo } from '../nav.js';
import { useLivePlayers } from '../live.js';
import './Home.css';

/**
 * Portada. El tapete de la mesa con las cuatro cartas de más fuerza del
 * guiñote (As, Tres, Rey, Sota; una de cada palo) y las dos formas de
 * jugar. Entrar en una mesa cuesta un toque.
 */
const FAN_CARDS = ['01-oros', '03-copas', '12-espadas', '10-bastos'] as const;

export function Home() {
  const createRoom = useGame((s) => s.createRoom);
  const live = useLivePlayers();
  const createParty = useParty((s) => s.create);
  const partyError = useParty((s) => s.error);
  const accountError = useAccount((s) => s.error);
  const joinRoom = useGame((s) => s.joinRoom);
  const error = useGame((s) => s.error);
  const [joinInput, setJoinInput] = useState('');
  // Nombre persistido en localStorage. Si nunca se ha editado, 'Jugador'.
  // Lo pasamos al server al crear/unirse para que los demás lo vean.
  const [name, setNameLocal] = useState<string>(() => getPlayerName());

  // Sincroniza cambios del campo nombre en localStorage (mientras escribe)
  // para que al pulsar crear/unirse el valor sea el último escrito.
  useEffect(() => {
    setPlayerName(name);
  }, [name]);

  const codeReady = joinInput.trim().length === 4;
  // S5-01: solicitudes de amistad sin responder.
  const pendingFriends = useFriends((s) => s.data?.incoming.length ?? 0);
  // S5-03: invitaciones a peñas (solo si aún no estás en ninguna).
  const loggedIn = useAccount((s) => s.me !== null);
  const refreshPena = usePena((s) => s.refresh);
  const penaInvites = usePena((s) => (s.data && !s.data.pena ? s.data.invites.length : 0));
  useEffect(() => {
    if (loggedIn) void refreshPena();
  }, [loggedIn, refreshPena]);

  return (
    <div className="home">
      <div className="home-inner">
        {/* Quién eres: discreto arriba (se cambia poco). La cuenta, a la
            derecha. Al entrar con Google, si aún te llamas "Jugador",
            cogemos tu nombre de pila. */}
        <div className="home-top">
          <NameChip
            name={name}
            onSave={(n) => {
              setNameLocal(n);
              // S4-04: con cuenta, también es tu nombre en el ranking.
              void useAccount.getState().saveName(n);
            }}
          />
          <AccountBar
            onGivenName={(given) => {
              if (name.trim() === '' || name === 'Jugador') setNameLocal(given.slice(0, 20));
            }}
          />
        </div>

        <div className="home-fan" aria-hidden="true">
          {FAN_CARDS.map((c) => (
            <img key={c} src={`/cards/sprite/${c}.png`} alt="" draggable={false} />
          ))}
        </div>

        <h1 className="home-title">
          Guiñote<small>aragonés</small>
        </h1>
        <p className="home-tagline">Por parejas, como en el bar del pueblo.</p>

        <div className="home-play">
          <button type="button" className="home-choice is-main" onClick={() => void createRoom('lobby')}>
            <b>Jugar online</b>
            <span>Rivales de tu nivel. Si faltan, bots.</span>
          </button>
          {/* S3-04: grupo de 2 → os sentamos enfrente. */}
          <button type="button" className="home-choice is-alt" onClick={() => void createParty()}>
            <b>Jugar con mi pareja</b>
            <span>Invita a un amigo y os sentamos juntos, enfrente.</span>
          </button>
          {live !== null && (
            <p className="home-live" aria-live="polite">
              <span className="home-live-dot" aria-hidden="true" />
              {live} jugadores conectados ahora
            </p>
          )}
        </div>

        {/* S4-04 */}
        <div className="home-links">
          <a className="home-ranking" href="#ranking">
            🏆 Ranking
          </a>
          {/* S5-01 */}
          <a className="home-ranking" href="#amigos">
            👥 Amigos
            {pendingFriends > 0 && (
              <span className="home-badge" aria-label={`${pendingFriends} solicitudes`}>
                {pendingFriends}
              </span>
            )}
          </a>
          {/* S5-05 */}
          <a className="home-ranking" href="#torneos">
            🎖️ Torneos
          </a>
          {/* S5-03 */}
          <a className="home-ranking" href="#pena">
            🍻 Peña
            {penaInvites > 0 && (
              <span className="home-badge" aria-label={`${penaInvites} invitaciones`}>
                {penaInvites}
              </span>
            )}
          </a>
        </div>

        {(error || partyError || accountError) && (
          <p className="home-error" role="alert">
            {error ?? partyError ?? accountError}
          </p>
        )}

        <AccountHint />

        <div className="home-friends">
          <h2 className="home-section">Con amigos</h2>
          <button type="button" className="home-choice is-alt" onClick={() => void createRoom('private')}>
            <b>Crear mesa privada</b>
            <span>Invita con un enlace, elige las parejas y empezad cuando queráis.</span>
          </button>
        </div>

        <form
          className="home-join"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeReady) joinRoom(joinInput);
          }}
        >
          <label htmlFor="home-join-code">¿Te han pasado un código?</label>
          <input
            id="home-join-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={4}
            placeholder="ABCD"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button type="submit" disabled={!codeReady}>
            Entrar
          </button>
        </form>

        {/* S3-08: practicar contra bots, al final y con el mismo formato que "Con amigos". */}
        <div className="home-friends home-bots" role="group" aria-labelledby="home-bots-title">
          <h2 id="home-bots-title" className="home-section">Contra bots</h2>
          <p className="home-bots-lead">Para practicar. Empiezas al momento.</p>
          <div className="home-levels">
            <button type="button" className="home-level" onClick={() => void createRoom('bots', 1)}>
              Fácil
            </button>
            <button type="button" className="home-level" onClick={() => void createRoom('bots', 2)}>
              Normal
            </button>
          </div>
        </div>

        <p className="home-rules">
          4 jugadores en 2 parejas. Gana la pareja que se lleve 3 partidas. <a href={PAGE_RULES} onClick={linkTo(PAGE_RULES)}>Cómo se juega</a>
        </p>
        <p className="home-legal"><a href={PAGE_PRIVACY} onClick={linkTo(PAGE_PRIVACY)}>Privacidad</a></p>

        {/* Primera visita: entrar con Google o seguir como invitado. */}
        <WelcomeSheet />
      </div>
    </div>
  );
}

/**
 * Tu nombre en la mesa, en pequeño: "Jugando como Jose ✎". Al tocarlo se
 * edita en el sitio. Si aún te llamas "Jugador", invita a ponerte nombre.
 */
function NameChip({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // S4-08: aviso si el nombre no está permitido (el servidor lo cambiaría por "Jugador").
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const unnamed = name.trim() === '' || name === 'Jugador';

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (editing) {
    const save = () => {
      const clean = draft.trim().slice(0, 20) || 'Jugador';
      if (isOffensiveName(clean)) {
        setBad(true);
        inputRef.current?.focus();
        return;
      }
      setBad(false);
      onSave(clean);
      setEditing(false);
    };
    return (
      <form
        className="name-edit"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          maxLength={20}
          autoComplete="nickname"
          spellCheck={false}
          aria-label="Tu nombre en la mesa"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.slice(0, 20));
            setBad(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setBad(false);
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (!bad) save();
          }}
          aria-invalid={bad}
          aria-describedby={bad ? 'name-bad' : undefined}
        />
        <button type="submit">Listo</button>
        {bad && (
          <p id="name-bad" className="name-bad" role="alert">
            Ese nombre no está permitido. Elige otro.
          </p>
        )}
      </form>
    );
  }

  return (
    <button
      type="button"
      className={`name-chip ${unnamed ? 'is-unnamed' : ''}`}
      onClick={() => {
        setDraft(unnamed ? '' : name);
        setEditing(true);
      }}
      aria-label={unnamed ? 'Ponte un nombre para la mesa' : `Tu nombre en la mesa: ${name}. Cambiar`}
    >
      {unnamed ? (
        <span>Ponte un nombre</span>
      ) : (
        <span>
          Jugando como <b>{name}</b>
        </span>
      )}
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
