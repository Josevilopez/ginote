import { useCallback, useEffect, useState } from 'react';
import { useGame } from './store.js';
import { Home } from './pages/Home.js';
import { Game } from './pages/Game.js';
import { Profile } from './pages/Profile.js';
import { Privacy } from './pages/Privacy.js';
import { Ranking } from './pages/Ranking.js';
import { Party } from './pages/Party.js';
import { Searching } from './pages/Searching.js';
import { Friends } from './pages/Friends.js';
import { InviteToast } from './components/InviteToast.js';
import { friendsRoute } from './friends.js';
import { listenForPushClicks } from './push.js';
import { partyCodeFromHash, useParty } from './party.js';
import { ConnectionBanner } from './components/ConnectionBanner.js';

export function App() {
  const you = useGame((s) => s.you);
  const searching = useGame((s) => s.queue !== null);
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

  // S5-02: tocar un aviso con la web ya abierta → ir a donde dice.
  useEffect(() => listenForPushClicks((code) => useGame.getState().joinRoom(code)), []);

  // S3-02: "Mi perfil" vive en `#perfil` (el botón Atrás del navegador
  // vuelve a la portada). Los códigos de sala son de 4 caracteres, así
  // que no chocan.
  const [onProfile, setOnProfile] = useState(() => window.location.hash === '#perfil');
  // S4-00: política de privacidad en `#privacidad`.
  const [onPrivacy, setOnPrivacy] = useState(() => window.location.hash === '#privacidad');
  // S4-04: ranking en `#ranking`.
  const [onRanking, setOnRanking] = useState(() => window.location.hash === '#ranking');
  // S5-01: amigos en `#amigos` (o `#amigos/Nombre%231234` para añadir).
  const [friends, setFriends] = useState(() => friendsRoute());
  // S3-04: invitación de pareja (`#pareja-ABCD`) y grupo activo.
  const [inviteCode, setInviteCode] = useState(() => partyCodeFromHash());
  const inParty = useParty((s) => s.saved !== null);
  const [partyClosed, setPartyClosed] = useState(false);
  useEffect(() => {
    const onHash = () => {
      setOnProfile(window.location.hash === '#perfil');
      setOnPrivacy(window.location.hash === '#privacidad');
      setOnRanking(window.location.hash === '#ranking');
      setFriends(friendsRoute());
      setInviteCode(partyCodeFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const closeProfile = useCallback(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setOnProfile(false);
  }, []);
  const closePrivacy = useCallback(() => {
    // Si vienes de otra pantalla de la app (perfil, portada), vuelve atrás.
    if (history.length > 1) history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setOnPrivacy(false);
    }
  }, []);
  const closeRanking = useCallback(() => {
    if (history.length > 1) history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setOnRanking(false);
    }
  }, []);
  const closeFriends = useCallback(() => {
    if (history.length > 1 && window.location.hash === '#amigos') history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setFriends(null);
    }
  }, []);
  const closeParty = useCallback(() => {
    if (partyCodeFromHash()) history.replaceState(null, '', window.location.pathname + window.location.search);
    setInviteCode(null);
    setPartyClosed(true);
  }, []);
  // Al crear o unirse a una pareja (o volver de una partida), su pantalla.
  useEffect(() => {
    if (inParty) setPartyClosed(false);
  }, [inParty, you]);
  const showParty = inviteCode !== null || (inParty && !partyClosed);

  return (
    <main className="app">
      {you !== null ? (
        <Game />
      ) : onRanking ? (
        <Ranking onBack={closeRanking} />
      ) : friends ? (
        <Friends onBack={closeFriends} prefill={friends.code} />
      ) : onPrivacy ? (
        <Privacy onBack={closePrivacy} />
      ) : searching ? (
        <Searching />
      ) : showParty ? (
        <Party inviteCode={inviteCode} onClose={closeParty} />
      ) : onProfile ? (
        <Profile onBack={closeProfile} />
      ) : (
        <Home />
      )}
      {you !== null && <ConnectionBanner />}
      <InviteToast />
    </main>
  );
}
