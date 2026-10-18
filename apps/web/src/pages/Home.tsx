import { useState, useEffect } from 'react';
import { useGame, getPlayerName, setPlayerName } from '../store.js';
import './Home.css';

/**
 * Portada. El tapete de la mesa con las cuatro cartas de más fuerza del
 * guiñote (As, Tres, Rey, Sota; una de cada palo) y las dos formas de
 * jugar. Entrar en una mesa cuesta un toque.
 */
const FAN_CARDS = ['01-oros', '03-copas', '12-espadas', '10-bastos'] as const;

export function Home() {
  const createRoom = useGame((s) => s.createRoom);
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

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-fan" aria-hidden="true">
          {FAN_CARDS.map((c) => (
            <img key={c} src={`/cards/sprite/${c}.png`} alt="" draggable={false} />
          ))}
        </div>

        <h1 className="home-title">
          Guiñote<small>aragonés</small>
        </h1>
        <p className="home-tagline">Por parejas, como en el bar del pueblo.</p>

        <label className="home-name">
          Tu nombre en la mesa
          <input
            type="text"
            maxLength={20}
            autoComplete="nickname"
            spellCheck={false}
            value={name}
            onChange={(e) => setNameLocal(e.target.value.slice(0, 20))}
          />
        </label>

        <div className="home-play">
          <button type="button" className="home-choice is-main" onClick={() => void createRoom('lobby')}>
            <b>Jugar online</b>
            <span>Te sentamos con otros jugadores. Si faltan, completan la mesa bots.</span>
          </button>
          <button type="button" className="home-choice is-alt" onClick={() => void createRoom('bots')}>
            <b>Practicar contra bots</b>
            <span>Empiezas al momento.</span>
          </button>
        </div>

        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}

        <form
          className="home-join"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeReady) joinRoom(joinInput);
          }}
        >
          <label htmlFor="home-join-code">¿Te han pasado un código de sala?</label>
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

        <p className="home-rules">4 jugadores en 2 parejas. Gana la pareja que se lleve 3 partidas.</p>
      </div>
    </div>
  );
}
