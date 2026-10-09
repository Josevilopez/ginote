import { useGame } from './store.js';
import { Home } from './pages/Home.js';
import { Game } from './pages/Game.js';

export function App() {
  const you = useGame((s) => s.you);
  return (
    <main className="app">
      {you === null ? <Home /> : <Game />}
    </main>
  );
}
