import { useState } from 'react';
import { useGame } from '../store.js';

export function Home() {
  const createRoom = useGame((s) => s.createRoom);
  const joinRoom = useGame((s) => s.joinRoom);
  const error = useGame((s) => s.error);
  const [joinInput, setJoinInput] = useState('');

  return (
    <div className="home">
      <h1>Guiñote</h1>
      <p className="subtitle">Aragonés · 4 jugadores · 2 parejas</p>
      <button className="btn primary big" onClick={() => void createRoom()}>
        Crear mesa con bots
      </button>
      <p className="hint">o únete a una sala existente:</p>
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
        Crea una sala y comparte el código (4 letras) con tu compañero
        para jugar online. O pega aquí el código que te han pasado.
      </p>
    </div>
  );
}
