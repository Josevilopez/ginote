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
  /**
   * El `commandId` de cada acción se genera con `crypto.randomUUID()` en
   * `sendAction` (no con un contador local). Un contador local
   * (`c-${lastCmdId + 1}`) colisionaba entre clientes: ambos arrancan
   * en 0 y generan `c-1`, `c-2`, ... en paralelo; el `seenCommandIds`
   * del server rechazaba el segundo en llegar como duplicado silencioso
   * y el segundo humano veía sus jugadas ignoradas.
   */
  /** Estado del lobby (sala esperando a más jugadores antes de repartir).
   *  `null` cuando ya hay partida empezada. `endsAt` es epoch ms o `null`
   *  si la ventana ya no está corriendo (lo contemplamos por seguridad).
   *  `windowMs` es la duración inicial de la ventana — el cliente la usa
   *  para dimensionar la barra depleting correctamente. */
  lobby: {
    seatsConnected: number;
    seatsTotal: number;
    endsAt: number | null;
    windowMs: number;
  } | null;
  /**
   * Hay una acción del usuario en vuelo: ya se envió al server pero aún
   * no llegó VIEW/ERROR del server confirmando o rechazando. Mientras
   * esté a true, `sendAction` es no-op (evita que un doble click mande
   * dos veces la misma carta y se rompa la lógica del server). Se
   * limpia al recibir VIEW, ERROR, GAME_OVER, MATCH_OVER o TRICK_JUST_RESOLVED.
   * Esto es la causa raíz de los bugs reportados en Sprint 1 ("hay que
   * pulsar dos veces", "cante duplicado"): sin este lock, el cliente
   * re-mandaba la acción antes de que llegase la respuesta del server.
   *
   * Mantenemos el ID de la carta en vuelo para que la UI pueda oscurecer
   * SOLO esa carta (no todas), y permitir drag/reorder en las demás
   * mientras se espera la respuesta del server.
   */
  pendingActionCardId: string | null;
  /**
   * Banner de error visible: se muestra durante 3 s cuando llega un
   * `ERROR` del server. Antes los errores se guardaban en `error` pero
   * el componente Game no los pintaba en la UI durante una partida
   * (sólo en Home), así que el usuario no se enteraba de que el server
   * había rechazado algo.
   */
  lastError: { message: string; ts: number } | null;
  error: string | null;

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
  /** Une al cliente a una sala existente por código. NO crea la sala. */
  joinRoom: (code: string) => void;
  sendAction: (action: Action) => void;
  /** Pide al servidor que reparta la siguiente mano. Lo dispara el botón
   *  "Continuar" del panel de resumen tras un GAME_OVER (o MATCH_OVER). */
  requestNextHand: () => void;
  leave: () => void;
}

let wsRef: WebSocket | null = null;
let justResolvedTimer: ReturnType<typeof setTimeout> | null = null;

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
  lobby: null,
  pendingActionCardId: null,
  lastError: null,
  error: null,

  // Estado de progresión partida → coto → match (lo envía el servidor
  // en cada VIEW). Inicializado a "1ª partida del 1er coto, todo a 0".
  partidas: { 0: 0, 1: 0 },
  cotos: { 0: 0, 1: 0 },
  partidaEnCoto: 1,
  cotoEnMatch: 1,
  matchFinished: false,
  matchChampion: null,

async createRoom() {
    set({ error: null, gameOver: null, matchOver: null, view: null, you: null, roomCode: null, justResolved: null, swapAnnouncement: null, lobby: null, pendingActionCardId: null, lastError: null });
    try {
      const resp = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Jugador' }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { code } = (await resp.json()) as { code: string };
      if (!code) throw new Error('Servidor no devolvió código de sala');
      // Metemos el código en el hash de la URL para que sea fácil de
      // compartir: la barra de direcciones ya muestra la URL completa
      // con `#ABCD`, lista para copiar y mandar al amigo. La entrada
      // al juego también puede hacerse pegando esta URL.
      history.replaceState(null, '', `#${code}`);
      connect(code, set, get);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: `No se pudo crear la sala: ${msg}. ¿Está el servidor corriendo en :3001?` });
    }
  },

  /**
   * Une al cliente a una sala existente. La diferencia con `createRoom`
   * es que aquí NO se llama al endpoint POST; simplemente se abre el WS
   * contra el código dado. El server asigna el primer slot libre al
   * cliente.
   *
   * Se usa desde la URL con hash `#ABCD` (auto-join al cargar) y desde
   * el input de "Unirse a sala" de la Home.
   */
  joinRoom(code: string) {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(clean)) {
      set({ error: `Código de sala inválido: "${code}". Debe ser 4 letras/números.` });
      return;
    }
    set({ error: null, gameOver: null, matchOver: null, view: null, you: null, roomCode: null, justResolved: null, swapAnnouncement: null, lobby: null, pendingActionCardId: null, lastError: null });
    // Mantenemos la URL con el hash sincronizado al código de la sala.
    // Si el usuario llegó con `#WXYZ` y se une, normalizamos al código
    // canónico que devolvió el server (mismas letras, mismo orden).
    history.replaceState(null, '', `#${clean}`);
    connect(clean, set, get);
  },

  sendAction(action) {
    const { ws, pendingActionCardId } = get();
    // Lock fundamental anti-doble-click POR CARTA. Si la carta que se
    // intenta jugar es la misma que ya está en vuelo (esperando
    // VIEW/ERROR), descartamos silenciosamente. Guardamos el ID de la
    // carta en vuelo para que la UI oscurezca SOLO esa carta.
    if (action.type === 'PLAY_CARD' && pendingActionCardId === action.cardId) {
      console.log('[debug] sendAction SKIPPED (pendingCardId match) action=', action);
      return;
    }
    // `commandId` único por acción. Antes era `c-${lastCmdId + 1}` (un
    // contador local) y eso provocaba colisiones entre los dos clientes
    // humanos que entran a la misma sala — cada cliente arrancaba en 0
    // y generaba `c-1`, `c-2`, ... en paralelo; el `seenCommandIds` del
    // server descartaba el segundo como duplicado silencioso.
    //
    // `crypto.randomUUID()` solo está disponible en contextos seguros
    // (HTTPS / localhost en algunos navegadores). Como accedemos al
    // juego por HTTP simple desde la LAN (`http://192.168.1.23:3001`),
    // Chromium lanza `TypeError: crypto.randomUUID is not a function`
    // y el sendAction muere antes de llegar al WS. Fallback con
    // timestamp base36 + 24 chars random: prefijado con `rb-` para que
    // sea fácil de distinguir en logs de los `uuid-` del camino feliz
    // y para ver de un vistazo qué clientes están en HTTP simple.
    const cmdId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `uuid-${crypto.randomUUID()}`
        : `rb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
    // DEBUG temporal: ver si sendAction se ejecuta y si el WS está OK.
    console.log('[debug] sendAction cmdId=', cmdId, 'action=', action, 'wsReady=', ws?.readyState);
    if (!ws || ws.readyState !== 1) return;
    const newPendingCardId = action.type === 'PLAY_CARD' ? action.cardId : null;
    set({ pendingActionCardId: newPendingCardId });
    ws.send(JSON.stringify({ type: 'ACTION', commandId: cmdId, action } satisfies ClientMessage));
  },

  requestNextHand() {
    const { ws } = get();
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'NEXT_HAND' } satisfies ClientMessage));
  },

  leave() {
    if (wsRef) {
      // Solo enviamos LEAVE si el socket sigue abierto — `readyState`
      // 1 = OPEN. Si ya está CLOSING/CLOSED/CONNECTING, `send` lanza
      // `WebSocket is already in CLOSING or CLOSED state` y la excepción
      // se ve en consola sin que podamos hacer nada útil.
      if (wsRef.readyState === 1) {
        wsRef.send(JSON.stringify({ type: 'LEAVE' } satisfies ClientMessage));
      }
      wsRef.close();
      wsRef = null;
    }
    set({ ws: null, roomCode: null, you: null, view: null, gameOver: null, matchOver: null, seatNames: [], isBot: [], justResolved: null, swapAnnouncement: null, lobby: null, pendingActionCardId: null, lastError: null });
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
        // WELCOME implica que el server respondió → no hay acción en vuelo.
        pendingActionCardId: null,
      });
    } else if (msg.type === 'LOBBY_STATUS') {
      // El servidor nos dice que la sala está esperando a más jugadores
      // antes de repartir. Limpiamos el view anterior (puede ser null ya,
      // pero si veníamos de un reconnect tras una mano, podría tener
      // basura) y guardamos el estado del lobby para que el componente
      // Game.tsx pinte "Esperando más jugadores…".
      set({
        lobby: {
          seatsConnected: msg.seatsConnected,
          seatsTotal: msg.seatsTotal,
          endsAt: msg.endsAt,
          windowMs: msg.windowMs,
        },
        // Limpiamos view cuando entramos en lobby (no debería llegar
        // nunca un VIEW mientras estamos en lobby, pero por si acaso).
        view: null,
        gameOver: null,
        matchOver: null,
        pendingActionCardId: null,
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
        // Salimos del lobby: la partida ya empezó. Limpiamos el flag
        // para que el componente Game.tsx muestre el tablero en vez del
        // overlay de "Esperando más jugadores…".
        lobby: null,
        // Lock anti-doble-click: llega VIEW nuevo → la acción anterior
        // se procesó → podemos aceptar otra.
        pendingActionCardId: null,
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
        // TRICK_JUST_RESOLVED puede llegar DESPUÉS de un VIEW (cuando la
        // baza se resuelve en medio del ciclo de bots), pero también es
        // una "respuesta" del server. Limpiar pendingAction aquí evita
        // que el lock se quede pegado si el VIEW justo antes no lo hizo
        // por algún motivo. Defense in depth.
        pendingActionCardId: null,
      });
      justResolvedTimer = setTimeout(() => {
        set({ justResolved: null });
        justResolvedTimer = null;
      }, 2500);
    } else if (msg.type === 'GAME_OVER') {
      set({
        gameOver: msg,
        // La mano terminó → ya no hay nada en vuelo.
        pendingActionCardId: null,
      });
      // Si la partida terminó, ocultar el gameOver de "Fin de mano" para que
      // el overlay dedicado de "¡Hemos ganado!" sea el protagonista.
      // Lo gestionamos desde el componente Game comparando con matchOver.
    } else if (msg.type === 'MATCH_OVER') {
      set({
        matchOver: msg,
        pendingActionCardId: null,
      });
    } else if (msg.type === 'SWAP_HAPPENED') {
      // Mostrar el overlay del swap. El timer de auto-clear vive en el
      // componente Game.tsx (useEffect) — antes estaba aquí pero daba
      // problemas con la suscripción de Zustand (el timer a nivel de
      // módulo no se conecta con el ciclo de vida del componente y a
      // veces limpiaba el overlay antes de que el usuario lo viera).
      set({
        swapAnnouncement: {
          uid: performance.now(),
          seat: msg.seat,
          taken: msg.taken as Card,
          given: msg.given as Card,
        },
        pendingActionCardId: null,
      });
    } else if (msg.type === 'ERROR') {
      // El server rechazó nuestra acción (probablemente porque re-enviamos
      // la misma antes de recibir VIEW — esto ya no debería pasar con el
      // lock `pendingAction`, pero por si acaso lo tratamos).
      // Limpiamos el lock y guardamos el mensaje en `lastError` para que
      // Game.tsx muestre un banner visible durante 3 s.
      set({
        error: msg.message,
        lastError: { message: msg.message, ts: Date.now() },
        pendingActionCardId: null,
      });
    }
  };

  ws.onopen = () => set({ ws });
  ws.onclose = () => set({ ws: null });
  ws.onerror = () => set({ error: 'Conexión perdida' });
}
