import { useState, useEffect } from 'react';
import { useGame, getPlayerName, setPlayerName } from '../store.js';

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

  return (
    <div className="home">
      <h1>Guiñote</h1>
      <p className="subtitle">Aragonés · 4 jugadores · 2 parejas</p>

      <label className="name-label">
        Tu nombre
        <input
          className="name-input"
          type="text"
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setNameLocal(e.target.value.slice(0, 20))}
          aria-label="Tu nombre"
        />
      </label>

      <div className="cta-row">
        <button
          className="btn primary big"
          onClick={() => void createRoom('bots')}
        >
          Jugar con bots
        </button>
        <button
          className="btn primary big"
          onClick={() => void createRoom('lobby')}
        >
          Jugar con jugadores
        </button>
      </div>

      <p className="hint">o únete a una sala existente con su código:</p>
      <form
        className="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (joinInput.trim().length === 4) joinRoom(joinInput);
        }}
      >
        <input
          className="join-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={4}
          placeholder="ABCD"
          value={joinInput}
          onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
          aria-label="Código de sala"
        />
        <button
          type="submit"
          className="btn"
          disabled={joinInput.trim().length !== 4}
        >
          Unirse
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        <strong>Jugar con bots</strong> crea una mesa con bots al instante,
        sin esperar. <strong>Jugar con jugadores</strong> te asigna a una
        sala abierta a matchmaking y espera 30 s a que entre alguien más
        antes de repartir.
      </p>
    </div>
  );
}