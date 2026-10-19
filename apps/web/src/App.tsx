import { useCallback, useEffect, useState } from 'react';
import { useGame } from './store.js';
import { Home } from './pages/Home.js';
import { Game } from './pages/Game.js';
import { Profile } from './pages/Profile.js';
import { ConnectionBanner } from './components/ConnectionBanner.js';

export function App() {
  const you = useGame((s) => s.you);
  const joinRoom = useGame((s) => s.joinRoom);

  // Auto-join desde el hash de la URL: `https://host/#ABCD` mete al
  // usuario en la sala ABCD. Lo hace una vez al montar. Si ya hay un
  // you (ya estamos en una sala) no hace nada.
  useEffect(() => {
    if (you !== null) return;
    const m = /^#?([A-Za-z0-9]{4})$/.exec(window.location.hash);
    if (m) {
      const code = m[1]!.toUpperCase();
      // Limpiamos el hash para que un refresh no re-intente entrar
      // (sería un fastidio si ya saliste y vuelves).
      history.replaceState(null, '', window.location.pathname + window.location.search);
      joinRoom(code);
    }
    // joinRoom se excluye del deps a propósito: no queremos re-join
    // cada vez que el store se actualice. La identidad de la función
    // cambia en cada render de Zustand; usar ref sería más correcto,
    // pero como solo se llama una vez al mount, no importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // S3-02: "Mi perfil" vive en `#perfil` (el botón Atrás del navegador
  // vuelve a la portada). Los códigos de sala son de 4 caracteres, así
  // que no chocan.
  const [onProfile, setOnProfile] = useState(() => window.location.hash === '#perfil');
  useEffect(() => {
    const onHash = () => setOnProfile(window.location.hash === '#perfil');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const closeProfile = useCallback(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setOnProfile(false);
  }, []);

  return (
    <main className="app">
      {you === null ? onProfile ? <Profile onBack={closeProfile} /> : <Home /> : <Game />}
      {you !== null && <ConnectionBanner />}
    </main>
  );
}
