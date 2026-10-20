import { useEffect } from 'react';
import { useAccount } from '../account.js';
import { FRIENDS_POLL_MS, useFriends } from '../friends.js';
import { useGame } from '../store.js';
import { usePena } from '../penas.js';
import { useParty } from '../party.js';
import '../pages/Friends.css';

/**
 * S5-01: con sesión, pregunta por tus amigos cada 15 s (así cuentas como
 * conectado) y muestra "Pilar te invita a jugar de pareja · Unirme / Ahora no".
 * Durante una partida no molesta: la invitación espera (caduca a los 2 min).
 */
export function InviteToast() {
  const me = useAccount((s) => s.me);
  const init = useAccount((s) => s.init);
  const inGame = useGame((s) => s.you !== null);
  const joinRoom = useGame((s) => s.joinRoom);
  const { data, dismissed, refresh, dismiss, clear } = useFriends();

  // Va en todas las pantallas: carga la cuenta aunque se entre por un enlace.
  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!me) {
      clear();
      usePena.setState({ data: undefined }); // S5-03: al cerrar sesión
      return;
    }
    void refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const id = window.setInterval(tick, FRIENDS_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [me, refresh, clear]);

  const inv = data?.invites.find((i) => !dismissed.includes(i.id));
  if (!me || inGame || !inv) return null;

  const accept = () => {
    void dismiss(inv.id);
    // Ya ha dicho "Unirme": entra directamente, sin otra pantalla.
    // Si estabas en otra pantalla (#amigos, #ranking…), se vuelve a la principal,
    // que es donde se ve la pareja o la mesa.
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    if (inv.kind === 'pareja') void useParty.getState().join(inv.code);
    else joinRoom(inv.code);
  };

  return (
    <div className="invite-toast" role="alertdialog" aria-labelledby="invite-toast-text">
      <p id="invite-toast-text">
        <b>{inv.fromName}</b> te invita a {inv.kind === 'pareja' ? 'jugar de pareja' : 'su mesa privada'}.
      </p>
      <div>
        <button type="button" className="is-yes" onClick={accept}>
          Unirme
        </button>
        <button type="button" className="is-no" onClick={() => void dismiss(inv.id)}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
