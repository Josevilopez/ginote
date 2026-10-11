import { create } from 'zustand';
import type { ClientMessage, ServerMessage } from '@guinote/protocol';
import type { Action, Card, PlayerView } from '@guinote/engine';

interface PartidaScore {
  buenas: { '0': number; '1': number };
  malas: { '0': number; '1': number };
}

interface State {
  // Conexión
  ws: WebSocket | null;
  roomCode: string | null;
  you: number | null;
  seatNames: string[];
  isBot: boolean[];

  // Juego
  view: PlayerView | null;
  /** Overlay de baza recién resuelta (se quita a los ~1.5s por el componente). */
  justResolved: { winner: number; plays: { seat: number; card: Card }[]; points: number; isLastTrick: boolean } | null;
  gameOver: {
    handPoints: { '0': number; '1': number };
    score?: PartidaScore | undefined;
    vuelta?: number | undefined;
    matchWinner?: 0 | 1 | null | undefined;
  } | null;
  /** Resultado final del coto (cuando un equipo cruza 100 raw). En la
   *  jerarquía match → coto → juego, "match" aquí significa coto. */
  matchOver: { winner: 0 | 1; score: PartidaScore; vuelta: number } | null;
  /** Overlay de swap del 7 por el triunfo. Lo emite el servidor tras
   *  aplicar SWAP_SEVEN; dura 3,5 s en pantalla igual que el cante. */
  swapAnnouncement: { uid: number; seat: number; taken: Card; given: Card } | null;
  error: string | null;
  lastCmdId: number;

  // Progresión partida → coto → match (gestionada por el servidor).
  // Usamos Record<0 | 1, number> en vez de `{ '0': ..., '1': ... }` para
  // poder indexar con `team` (que es `0 | 1`) sin casts feos. En
  // runtime son objetos idénticos (las keys se serializan a '0'/'1').
  /** Partidas (idas/vueltas) ganadas en el coto actual, por equipo. */
  partidas: Record<0 | 1, number>;
  /** Cotos (sets de 3 partidas) ganados en el match, por equipo. */
  cotos: Record<0 | 1, number>;
  /** Partida actual dentro del coto (1..3). */
  partidaEnCoto: number;
  /** Coto actual dentro del match (1..2). */
  cotoEnMatch: number;
  /** El match entero ha terminado (alguien hizo 2 cotos). */
  matchFinished: boolean;
  /** Ganador del match (0 o 1). */
  matchChampion: 0 | 1 | null;

  // Acciones
  createRoom: () => Promise<void>;
  sendAction: (action: Action) => void;
  /** Pide al servidor que reparta la siguiente mano. Lo dispara el botón
   *  "Continuar" del panel de resumen tras un GAME_OVER (o MATCH_OVER). */
  requestNextHand: () => void;
  leave: () => void;
}

let wsRef: WebSocket | null = null;
let justResolvedTimer: ReturnType<typeof setTimeout> | null = null;
let swapTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<State>((set, get) => ({
  ws: null,
  roomCode: null,
  you: null,
  seatNames: [],
  isBot: [],
  view: null,
  justResolved: null,
  gameOver: null,
  matchOver: null,
  swapAnnouncement: null,
  error: null,
  lastCmdId: 0,

  // Estado de progresión partida → coto → match (lo envía el servidor
  // en cada VIEW). Inicializado a "1ª partida del 1er coto, todo a 0".
  partidas: { 0: 0, 1: 0 },
  cotos: { 0: 0, 1: 0 },
  partidaEnCoto: 1,
  cotoEnMatch: 1,
  matchFinished: false,
  matchChampion: null,

  async createRoom() {
    set({ error: null, gameOver: null, matchOver: null, view: null, you: null, roomCode: null, justResolved: null, swapAnnouncement: null });
    try {
      const resp = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Jugador' }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { code } = (await resp.json()) as { code: string };
      if (!code) throw new Error('Servidor no devolvió código de sala');
      connect(code, set, get);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: `No se pudo crear la sala: ${msg}. ¿Está el servidor corriendo en :3001?` });
    }
  },

  sendAction(action) {
    const { ws, lastCmdId } = get();
    if (!ws || ws.readyState !== 1) return;
    const cmdId = `c-${lastCmdId + 1}`;
    set({ lastCmdId: lastCmdId + 1 });
    ws.send(JSON.stringify({ type: 'ACTION', commandId: cmdId, action } satisfies ClientMessage));
  },

  requestNextHand() {
    const { ws } = get();
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'NEXT_HAND' } satisfies ClientMessage));
  },

  leave() {
    if (wsRef) {
      wsRef.send(JSON.stringify({ type: 'LEAVE' } satisfies ClientMessage));
      wsRef.close();
      wsRef = null;
    }
    set({ ws: null, roomCode: null, you: null, view: null, gameOver: null, matchOver: null, seatNames: [], isBot: [], justResolved: null, swapAnnouncement: null });
  },
}));

function connect(
  code: string,
  set: (partial: Partial<State>) => void,
  get: () => State,
) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${window.location.host}/ws/${code}`);
  wsRef = ws;

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    if (msg.type === 'WELCOME') {
      set({
        you: msg.you,
        roomCode: msg.roomCode,
        seatNames: msg.seatNames,
        isBot: msg.isBot,
      });
    } else if (msg.type === 'VIEW') {
      const newView = msg.view as PlayerView;
      // Detectar transición de mano terminada → nueva mano: si la vista
      // anterior estaba en 'finished' y la nueva ya no, limpiamos el
      // resumen de "Fin de mano" para que no se quede pegado al iniciar
      // la siguiente.
      const prevView = get().view;
      const isNewHand =
        prevView !== null &&
        prevView.phase === 'finished' &&
        newView.phase !== 'finished';
      set({
        view: newView,
        gameOver: isNewHand ? null : get().gameOver,
        matchOver: isNewHand ? null : get().matchOver,
        // Estado de progresión partida → coto → match. Si el servidor
        // aún no lo manda (cliente viejo, sin el nuevo campo), nos
        // quedamos con el estado anterior.
        partidas: msg.partidas ?? get().partidas,
        cotos: msg.cotos ?? get().cotos,
        partidaEnCoto: msg.partidaEnCoto ?? get().partidaEnCoto,
        cotoEnMatch: msg.cotoEnMatch ?? get().cotoEnMatch,
        matchFinished: msg.matchFinished ?? get().matchFinished,
        matchChampion: msg.matchChampion ?? get().matchChampion,
      });
    } else if (msg.type === 'TRICK_JUST_RESOLVED') {
      // Mostrar el overlay durante 2,5 s. Si llega otro antes, se resetea.
      // Ajustado para que la "carta ganadora" no se eternice — el jugador
      // ya tiene el truco visible en la mesa, el overlay solo resalta.
      if (justResolvedTimer) clearTimeout(justResolvedTimer);
      set({
        justResolved: {
          winner: msg.winner,
          plays: msg.plays as { seat: number; card: Card }[],
          points: msg.points,
          isLastTrick: msg.isLastTrick,
        },
      });
      justResolvedTimer = setTimeout(() => {
        set({ justResolved: null });
        justResolvedTimer = null;
      }, 2500);
    } else if (msg.type === 'GAME_OVER') {
      set({ gameOver: msg });
      // Si la partida terminó, ocultar el gameOver de "Fin de mano" para que
      // el overlay dedicado de "¡Hemos ganado!" sea el protagonista.
      // Lo gestionamos desde el componente Game comparando con matchOver.
    } else if (msg.type === 'MATCH_OVER') {
      set({ matchOver: msg });
    } else if (msg.type === 'SWAP_HAPPENED') {
      // Mostrar el overlay del swap 3,5 s. Si llega otro swap mientras,
      // `uid` cambia y el effect en Game.tsx resetea el timer.
      if (swapTimer) clearTimeout(swapTimer);
      set({
        swapAnnouncement: {
          uid: performance.now(),
          seat: msg.seat,
          taken: msg.taken as Card,
          given: msg.given as Card,
        },
      });
      swapTimer = setTimeout(() => {
        set({ swapAnnouncement: null });
        swapTimer = null;
      }, 3500);
    } else if (msg.type === 'ERROR') {
      set({ error: msg.message });
    }
  };

  ws.onopen = () => set({ ws });
  ws.onclose = () => set({ ws: null });
  ws.onerror = () => set({ error: 'Conexión perdida' });
}
