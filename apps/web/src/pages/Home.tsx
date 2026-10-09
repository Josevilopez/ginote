import { useGame } from '../store.js';

export function Home() {
  const createRoom = useGame((s) => s.createRoom);
  const error = useGame((s) => s.error);

  return (
    <div className="home">
      <h1>Guiñote</h1>
      <p className="subtitle">Aragonés · 4 jugadores · 2 parejas</p>
      <button className="btn primary big" onClick={() => void createRoom()}>
        Crear mesa con bots
      </button>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        Para esta primera versión solo puedes jugar contra 3 bots. Elige la
        carta que quieras tocar — los bots responden solos.
      </p>
    </div>
  );
}
