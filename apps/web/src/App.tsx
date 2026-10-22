import { useCallback, useEffect, useState } from 'react';
import { useGame } from './store.js';
import { Home } from './pages/Home.js';
import { Game } from './pages/Game.js';
import { Profile } from './pages/Profile.js';
import { Privacy } from './pages/Privacy.js';
import { Rules } from './pages/Rules.js';
import { Ranking } from './pages/Ranking.js';
import { Party } from './pages/Party.js';
import { Searching } from './pages/Searching.js';
import { Friends } from './pages/Friends.js';
import { Pena } from './pages/Pena.js';
import { penaRoute } from './penas.js';
import { Torneos } from './pages/Torneos.js';
import { torneoRoute } from './torneos.js';
import { InviteToast } from './components/InviteToast.js';
import { friendsRoute } from './friends.js';
import { listenForPushClicks } from './push.js';
import { PAGE_PRIVACY, PAGE_RULES, closePage } from './nav.js';
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
  // SEO: también en `/privacidad` y `/como-se-juega` (páginas con HTML propio).
  const isPrivacyLoc = () => window.location.hash === '#privacidad' || window.location.pathname === PAGE_PRIVACY;
  const isRulesLoc = () => window.location.hash === '#reglas' || window.location.pathname === PAGE_RULES;
  const [onPrivacy, setOnPrivacy] = useState(isPrivacyLoc);
  // "Cómo se juega" en `#reglas`.
  const [onRules, setOnRules] = useState(isRulesLoc);
  // S4-04: ranking en `#ranking`.
  const [onRanking, setOnRanking] = useState(() => window.location.hash === '#ranking');
  // S5-01: amigos en `#amigos` (o `#amigos/Nombre%231234` para añadir).
  const [friends, setFriends] = useState(() => friendsRoute());
  // S5-03: peña en `#pena` (o `#pena-CODIGO` para entrar en una).
  const [pena, setPena] = useState(() => penaRoute());
  // S5-05: torneos en `#torneos` y `#torneo-<id>`.
  const [torneo, setTorneo] = useState(() => torneoRoute());
  // S3-04: invitación de pareja (`#pareja-ABCD`) y grupo activo.
  const [inviteCode, setInviteCode] = useState(() => partyCodeFromHash());
  const inParty = useParty((s) => s.saved !== null);
  const [partyClosed, setPartyClosed] = useState(false);
  useEffect(() => {
    const onHash = () => {
      setOnProfile(window.location.hash === '#perfil');
      setOnPrivacy(isPrivacyLoc());
      setOnRules(isRulesLoc());
      setOnRanking(window.location.hash === '#ranking');
      setFriends(friendsRoute());
      setPena(penaRoute());
      setTorneo(torneoRoute());
      setInviteCode(partyCodeFromHash());
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeProfile = useCallback(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setOnProfile(false);
  }, []);
  const closePrivacy = useCallback(() => {
    if (window.location.pathname === PAGE_PRIVACY) return closePage();
    // Si vienes de otra pantalla de la app (perfil, portada), vuelve atrás.
    if (history.length > 1) history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setOnPrivacy(false);
    }
  }, []);
  const closeRules = useCallback(() => {
    if (window.location.pathname === PAGE_RULES) return closePage();
    if (history.length > 1) history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setOnRules(false);
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
  const closePena = useCallback(() => {
    if (history.length > 1 && window.location.hash === '#pena') history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setPena(null);
    }
  }, []);
  // Al unirse desde una invitación: se quita `#pareja-ABCD` pero se sigue en
  // la pantalla de la pareja (no a la portada).
  const joinedParty = useCallback(() => {
    if (partyCodeFromHash()) history.replaceState(null, '', window.location.pathname + window.location.search);
    setInviteCode(null);
    setPartyClosed(false);
  }, []);
  const closeTorneo = useCallback(() => {
    if (history.length > 1) history.back();
    else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setTorneo(null);
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
      ) : torneo ? (
        <Torneos id={torneo.id} onBack={closeTorneo} />
      ) : pena ? (
        <Pena onBack={closePena} joinCode={pena.code} />
      ) : friends ? (
        <Friends onBack={closeFriends} prefill={friends.code} />
      ) : onRules ? (
        <Rules onBack={closeRules} />
      ) : onPrivacy ? (
        <Privacy onBack={closePrivacy} />
      ) : searching ? (
        <Searching />
      ) : showParty ? (
        <Party inviteCode={inviteCode} onClose={closeParty} onJoined={joinedParty} />
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
