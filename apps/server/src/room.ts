import {
  apply,
  GUINOTE_ARAGONES,
  legalActions,
  newHand,
  nextDealer,
  type GameState,
  type Seat,
  type Play,
  viewFor,
  type PlayerView,
  type Card,
  type GameEvent,
} from '@guinote/engine';
import { stepHeuristicBot, heuristicBotAction } from '@guinote/bots';

/**
 * Nombres típicos aragoneses para los bots de la sala. Pensado para
 * ambientar el guiñote aragonés: en lugar de "Bot 2 / Bot 3 / Bot 4",
 * el rival lleva un nombre de la tierra. La fuente son listas de nombres
 * frecuentes en Aragón (gente mayor, pueblos) que pidió el usuario.
 * Se mezclan hombres y mujeres para evitar presuponer el género del
 * jugador humano: la sala los elige al azar y el humano, al unirse,
 * sobrescribe el nombre del slot que ocupa con el suyo (HELLO).
 */
const ARAGON_BOT_NAMES_MALE = [
  'José', 'Jorge', 'Miguel', 'Antonio', 'Joaquín', 'Manuel',
  'Pascual', 'Vicente', 'Ramiro', 'Sancho',
] as const;
const ARAGON_BOT_NAMES_FEMALE = [
  'Pilar', 'María', 'Carmen', 'Pilarín', 'Dolores', 'Josefa',
  'Engracia', 'Pascuala', 'Rosario', 'Orosia',
] as const;

/**
 * Sortea `n` nombres únicos del pool combinado (hombres + mujeres)
 * usando un Fisher–Yates parcial. Garantiza que nunca se repita un
 * nombre en la misma sala y que el orden sea aleatorio.
 */
function pickAragonBotNames(n: number): string[] {
  const pool: string[] = [
    ...ARAGON_BOT_NAMES_MALE,
    ...ARAGON_BOT_NAMES_FEMALE,
  ];
  // Shuffle in place (Fisher–Yates) y nos quedamos con los primeros n.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(n, pool.length));
}
import type { ServerMessage } from '@guinote/protocol';

export interface PlayerSlot {
  seat: Seat;
  /** Nombre visible (puede ser "Bot 2"). */
  name: string;
  /** null = bot. string = token de reconexión del cliente. */
  token: string | null;
  ws: WebSocket | null;
}

export interface Room {
  code: string;
  players: PlayerSlot[];
  /**
   * Estado de la partida. `null` mientras la sala está en LOBBY (esperando
   * a que se unan más humanos antes de repartir). Una vez expira la
   * ventana del lobby o se llenan los 4 slots, se reparte y `state`
   * pasa a un `GameState` real con `phase: 'lead'`.
   */
  state: GameState | null;
  /** Set de commandIds ya procesados (idempotencia básica). */
  seenCommandIds: Set<string>;
  /** Eventos pendientes para el log. */
  log: GameEvent[];
  /**
   * Timer de red de seguridad: si pasan N segundos (por defecto 10s) con
   * el turno en un humano y sin que llegue ninguna ACTION, el server
   * auto-aplica la primera acción legal para que la partida no se quede
   * colgada. Cubre tres modos de fallo que no podemos distinguir desde
   * el server: (a) el humano está distraído / no ve sus cartas, (b) la
   * WS del móvil se cayó silenciosamente, (c) la UI del cliente no
   * habilita las cartas en su turno. Cualquiera que sea, la partida
   * avanza. Se limpia al llegar una ACTION del humano correspondiente.
   */
  autoPlayTimer: NodeJS.Timeout | null;
  /**
   * Timer del lobby: cuando `state === null`, está corriendo el contador
   * para que se una otro humano. Se cancela si se llena la mesa antes
   * de que expire. Si vence, se rellena con bots y se reparte.
   */
  lobbyTimer: NodeJS.Timeout | null;
  /** Momento (ms epoch) en que expira el lobby, para que el cliente
   *  muestre cuenta atrás. `null` si la sala no está en lobby. */
  lobbyEndsAt: number | null;
  /** Duración de la ventana inicial del lobby (ms). Si se suma un humano
   *  adicional durante la ventana, el timer se reinicia con un valor
   *  menor (ver `scheduleLobbyCheck`). */
  lobbyWindowMs: number;

  // ─── Estructura del match completo (coto → partida → juego) ───
  // Terminología usada en este código (alineada con el cliente y el
  // dominio del juego):
  //   - partida: una ida o vuelta individual. Gana el equipo que cruza
  //     los 100 puntos raw del coto (lo que el motor llama
  //     `state.matchEnded`). Aquí se cuentan como `partidas[team]`.
  //   - coto: un set de 3 partidas consecutivas ganadas. Se cuentan
  //     como `cotos[team]`.
  //   - match: la serie entera. Lo gana el primer equipo que suma
  //     2 cotos (`cotos[team] >= 2`).
  //
  // El motor solo rastrea el coto actual. La capa del servidor
  // (Room) lleva la cuenta de partidas/cotos/match y orquesta las
  // transiciones en `triggerNextHand`.

  /** Partidas (idas/vueltas) ganadas en el coto actual, por equipo. */
  partidas: { 0: number; 1: number };
  /** Cotos (sets de 3 partidas) ganados en el match, por equipo. */
  cotos: { 0: number; 1: number };
  /** Partida actual dentro del coto (1..3). */
  partidaEnCoto: number;
  /** Coto actual dentro del match (1..2). */
  cotoEnMatch: number;
  /** El match entero ha terminado (una pareja ha hecho 2 cotos). */
  matchFinished: boolean;
  /** Equipo ganador del match (0 o 1), null mientras no haya terminado. */
  matchChampion: 0 | 1 | null;
}

/**
 * Crea una sala vacía. Los seats se rellenan al conectarse los clientes.
 * Para esta primera versión, el primer cliente en llegar toma seat 0; los
 * demás se asignan a slots libres (bots en modo `fillWithBots`).
 */
export function createRoom(opts: {
  code: string;
  fillWithBots?: boolean;
}): Room {
  const fill = opts.fillWithBots !== false;
  const players: PlayerSlot[] = [];
  // Sorteo de nombres aragoneses para los bots. Hay 20 nombres en el
  // pool (10 masculinos + 10 femeninos), así que con 4 slots iniciales
  // nunca se repite. Cuando un humano se une y se asigna a un slot,
  // su HELLO sobrescribe este nombre con el suyo — los bots restantes
  // conservan los suyos.
  const botNames = pickAragonBotNames(4);
  for (let s = 0 as Seat; s < 4; s = (s + 1) as Seat) {
    if (fill) {
      players.push({ seat: s, name: botNames[s]!, token: null, ws: null });
    } else {
      players.push({ seat: s, name: '?', token: null, ws: null });
    }
  }

  // Modo lobby (default en producción): `state` queda `null` hasta que
  // arranque la partida. Solo se reparte cuando se llene la mesa o
  // expire la ventana del lobby (ver `scheduleLobbyCheck`). En el modo
  // `fillWithBots: true` (legacy), repartimos inmediatamente como
  // antes.
  const state: GameState | null = fill
    ? newHand({
        id: `g-${opts.code}`,
        seed: cryptoToken(),
        rules: GUINOTE_ARAGONES,
        // Sorteo inicial: el dealer de la primera mano se elige al azar entre
        // los 4 asientos. A partir de ahí se aplica la regla del guiñote
        // aragonés: "el que corta, reparte" (winner of last trick → next dealer),
        // y siempre tira el de la derecha del dealer. Implementado en
        // `startNextHand` + `nextDealer` del motor.
        dealer: Math.floor(Math.random() * 4) as Seat,
      })
    : null;

  return {
    code: opts.code,
    players,
    state,
    seenCommandIds: new Set(),
    log: [],
    autoPlayTimer: null,
    lobbyTimer: null,
    lobbyEndsAt: null,
    lobbyWindowMs: 30000,
    partidas: { 0: 0, 1: 0 },
    cotos: { 0: 0, 1: 0 },
    partidaEnCoto: 1,
    cotoEnMatch: 1,
    matchFinished: false,
    matchChampion: null,
  };
}

function cryptoToken(): string {
  // En Node 22 hay globalThis.crypto.randomUUID().
  return globalThis.crypto.randomUUID();
}

/**
 * Emite un mensaje a todos los jugadores humanos conectados. Bots no reciben.
 */
function broadcast(room: Room, msg: ServerMessage): void {
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify(msg));
    }
  }
}

/**
 * Emite la vista personalizada para cada jugador humano.
 */
function broadcastView(room: Room): void {
  if (room.state === null) return; // sala en lobby, no hay VIEW todavía
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      const view: PlayerView = viewFor(room.state, p.seat);
      p.ws.send(JSON.stringify({
        type: 'VIEW',
        view,
        version: room.state.version,
        // Estado de la progresión partida → coto → match, gestionado
        // por el servidor. El cliente lo lee para mostrar el marcador
        // y decidir qué panel de fin de mano enseñar.
        partidas: room.partidas,
        cotos: room.cotos,
        partidaEnCoto: room.partidaEnCoto,
        cotoEnMatch: room.cotoEnMatch,
        matchFinished: room.matchFinished,
        matchChampion: room.matchChampion,
      } satisfies ServerMessage));
      // DEBUG temporal: confirmar que el VIEW se envía al cliente.
      console.log(`[ws-debug-out] VIEW -> seat=${p.seat} code=${room.code} turn=${view.turn} phase=${view.phase} v=${room.state.version}`);
    }
  }
}

/**
 * Emite un `LOBBY_STATUS` a todos los humanos conectados. Se usa mientras
 * la sala está esperando a que se unan más jugadores antes de repartir.
 * El cliente lo lee para mostrar "Esperando más jugadores… Ns".
 */
export function broadcastLobbyStatus(room: Room): void {
  const msg = {
    type: 'LOBBY_STATUS',
    code: room.code,
    seatsConnected: room.players.filter((p) => p.token !== null).length,
    seatsTotal: 4,
    endsAt: room.lobbyEndsAt,
    windowMs: room.lobbyWindowMs,
    seatNames: room.players.map((p) => p.name),
    isBot: room.players.map((p) => p.token === null),
  } as ServerMessage;
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
}

/**
 * Programa la comprobación del lobby. Si la sala tiene `state === null`
 * (modo lobby), mira si ya están los 4 slots ocupados por humanos:
 *  - Si los 4 son humanos: arranca la partida al instante.
 *  - Si hay 1+ humano y huecos: programa un timer para rellenar con bots
 *    cuando expire. Cada nuevo humano que se una REINICIA el timer
 *    (con un valor proporcionalmente menor, para que se note que la
 *    ventana se va acortando). Los bots no cuentan para esto: solo
 *    importan los humanos conectados.
 *
 * No-op si la sala ya tiene partida empezada.
 */
export function scheduleLobbyCheck(room: Room): void {
  if (room.state !== null) return;
  const humans = room.players.filter((p) => p.token !== null).length;
  const total = 4;
  clearLobbyTimer(room);
  if (humans >= total) {
    // Mesa llena de humanos: arrancar inmediatamente.
    startMatchAndDeal(room);
    return;
  }
  if (humans === 0) {
    // Nadie conectado: no hacer nada, esperar a que entre el primero.
    room.lobbyEndsAt = null;
    return;
  }
  // Al menos un humano. La ventana se va acortando conforme se unen más
  // humanos: 1 → ventana completa; 2 → mitad; 3 → cuarto. Así, cuando
  // ya hay 3 conectados apenas esperamos, y el primero tiene los 30s
  // enteros para invitar a quien quiera.
  const remaining = Math.max(
    1500,
    Math.floor(room.lobbyWindowMs * Math.pow(0.5, humans - 1)),
  );
  room.lobbyEndsAt = Date.now() + remaining;
  room.lobbyTimer = setTimeout(() => {
    room.lobbyTimer = null;
    if (room.state !== null) return; // ya empezó, race
    startMatchAndDeal(room);
  }, remaining);
  // Re-emitir para que el cliente reciba el `endsAt` actualizado (la
  // emisión inicial en index.ts se hace con lobbyEndsAt aún null porque
  // scheduleLobbyCheck no había corrido).
  broadcastLobbyStatus(room);
}

export function clearLobbyTimer(room: Room): void {
  if (room.lobbyTimer) {
    clearTimeout(room.lobbyTimer);
    room.lobbyTimer = null;
  }
  room.lobbyEndsAt = null;
}

/**
 * Llamado al expirar la ventana del lobby O cuando se llena la mesa de
 * humanos. Rellena los huecos con bots (los humanos que ya están
 * conectados conservan sus nombres vía HELLO), reparte la primera mano
 * con un dealer aleatorio y emite los VIEWs a todos.
 */
function startMatchAndDeal(room: Room): void {
  if (room.state !== null) return;
  // Asignar bots a los slots vacíos (los que NO tienen token humano).
  const botNames = pickAragonBotNames(4);
  for (let s = 0 as Seat; s < 4; s = (s + 1) as Seat) {
    const p = room.players[s]!;
    if (p.token === null) {
      p.name = botNames[s]!;
    }
  }
  room.state = newHand({
    id: `g-${room.code}`,
    seed: cryptoToken(),
    rules: GUINOTE_ARAGONES,
    dealer: Math.floor(Math.random() * 4) as Seat,
  });
  room.seenCommandIds.clear();
  room.lobbyEndsAt = null;
  // El cliente recibió los seatNames con '?' en el WELCOME original.
  // Ahora que los bots ya tienen nombre real, re-emitimos un WELCOME
  // actualizado a cada humano para que pinte los avatares con sus
  // nombres. Sin esto, los bots seguirían mostrándose como '?'.
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1 && p.token !== null) {
      p.ws.send(JSON.stringify({
        type: 'WELCOME',
        you: p.seat,
        roomCode: room.code,
        seatNames: room.players.map((pl) => pl.name),
        isBot: room.players.map((pl) => pl.token === null),
      } satisfies ServerMessage));
    }
  }
  // broadcastView hace el trabajo: salta automáticamente si state === null,
  // pero aquí ya es no-null. stepBots arranca por si el primer turno
  // cae en un bot (mesa recién creada con dealer aleatorio).
  broadcastView(room);
  void stepBots(room).catch(() => undefined);
}

/**
 * Red de seguridad: si pasan N segundos con el turno en un humano sin
 * que llegue una ACTION, el server auto-aplica la primera acción legal
 * en su nombre. Ver el campo `autoPlayTimer` en `Room` para el motivo.
 *
 * No-op si el turno actual no es de un humano (bot, finished, o null).
 * `clearAutoPlayTimer` debe llamarse en cuanto el humano actúa (en el
 * handler de ACTION en index.ts) para no aplicarle una acción encima.
 *
 * El timeout elegido (10s por defecto) es más largo que la pausa
 * entre turnos de bots (1s) pero más corto que la pausa de baza
 * resuelta (2,5s). Si vemos que dispara demasiado, lo subimos.
 */
export function scheduleAutoPlay(room: Room, delayMs = 10_000): void {
  clearAutoPlayTimer(room);
  if (room.state === null) return;
  if (room.state.phase === 'finished') return;
  const turn = room.state.turn;
  if (turn === null) return;
  if (room.players[turn]!.token === null) return; // es un bot, los bots no necesitan red de seguridad
  room.autoPlayTimer = setTimeout(() => {
    room.autoPlayTimer = null;
    autoPlayForHuman(room, turn);
  }, delayMs);
}

export function clearAutoPlayTimer(room: Room): void {
  if (room.autoPlayTimer) {
    clearTimeout(room.autoPlayTimer);
    room.autoPlayTimer = null;
  }
}

function autoPlayForHuman(room: Room, seat: Seat): void {
  // Re-validamos el estado en el callback del timer: el humano
  // podría haber actuado justo antes de que disparara.
  if (room.state === null) return;
  if (room.state.phase === 'finished') return;
  if (room.state.turn !== seat) return;
  if (room.players[seat]!.token === null) return;
  const legal = legalActions(room.state, seat);
  if (legal.length === 0) return;
  // Cogemos la primera acción legal. PLAY_CARD no es determinista con
  // el primero, pero en guiñote aragonés el orden de la mano es
  // estable, así que es la carta más baja que cumple las reglas. Para
  // no aburrir demasiado, mezclamos con la heurística del bot: si hay
  // varias opciones, elige la peor carta del palo obligatorio (mismo
  // criterio que `heuristicBotAction`).
  let action = legal[0]!;
  if (legal.length > 1) {
    const heuristic = heuristicBotAction(room.state, seat);
    if (heuristic && legal.some((a) => sameAction(a, heuristic))) {
      action = heuristic;
    }
  }
  console.log(`[autoPlay] seat=${seat} action=${JSON.stringify(action)} code=${room.code}`);
  const ok = applyActionWithResolveEvent(room, seat, action);
  if (!ok) return;
  emitAfterChange(room);
  // Tras el auto-play, pueden quedar bots por tirar. stepBots se
  // encargará; al final del bucle, scheduleAutoPlay (que se llama
  // también desde el WELCOME/ACTION handler) re-evaluará.
  void stepBots(room)
    .catch(() => undefined)
    .finally(() => scheduleAutoPlay(room));
}

/**
 * Emite un evento `TRICK_JUST_RESOLVED` con los detalles de la última baza
 * recién resuelta, para que el cliente muestre un overlay con las 4 cartas
 * durante un instante.
 */
function broadcastTrickResolved(room: Room, trick: { winner: Seat; plays: readonly Play[]; trickPoints: number; hadLastTrick: boolean }): void {
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'TRICK_JUST_RESOLVED',
        winner: trick.winner,
        plays: trick.plays.map((pl) => ({ seat: pl.seat, card: pl.card })),
        points: trick.trickPoints,
        isLastTrick: trick.hadLastTrick,
      } satisfies ServerMessage));
    }
  }
}

/**
 * Aplica una acción y, si resuelve una baza, emite el evento
 * `TRICK_JUST_RESOLVED` justo después. Si la acción era un
 * `SWAP_SEVEN`, emite también `SWAP_HAPPENED` con las cartas
 * intercambiadas para que el cliente muestre el overlay centrado.
 * Devuelve `true` si la acción era legal.
 *
 * El caller debe emitir la VIEW después (con `emitAfterChange`).
 */
export function applyActionWithResolveEvent(
  room: Room,
  seat: Seat,
  action: Parameters<typeof apply>[1],
): boolean {
  if (room.state === null) return false;
  const before = room.state.finishedTricks.length;
  const ok = applyAction(room, seat, action);
  if (!ok) return false;
  const after = room.state.finishedTricks.length;
  if (after > before) {
    const last = room.state.finishedTricks[after - 1]!;
    broadcastTrickResolved(room, last);
  }
  // Swap del 7: el motor ya intercambió `state.trumpCard` ↔
  // `state.hands[seat]`, así que `state.trumpCard` ahora es el 7 que
  // soltó el jugador y podemos sacar su nueva carta mirando lo que
  // tiene en la mano. Para no recalcular el diff, emitimos ambas
  // cartas que el motor conoce: el 7 que soltó (que ahora es el
  // trumpCard visible) y la carta del triunfo que acaba de recibir
  // (el motor aún la expone en su `log` — pero como alternativa
  // robusta usamos el diff de la mano + trumpCard).
  if (action.type === 'SWAP_SEVEN' && room.state.trumpCard !== null) {
    const sevenNowInDeck = room.state.trumpCard; // rank 7 del palo de triunfo
    // La carta del triunfo que recibió el jugador es la que tiene
    // rank !== 7 y suit === trump. La buscamos en su mano.
    const takenCard = room.state.hands[seat]!.find(
      (c) => c.suit === sevenNowInDeck.suit && c.rank !== 7,
    );
    if (takenCard) {
      const msg = {
        type: 'SWAP_HAPPENED',
        seat,
        taken: takenCard,
        given: sevenNowInDeck,
      } satisfies ServerMessage;
      for (const p of room.players) {
        if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
      }
    }
  }
  return true;
}

/**
 * Aplica una acción al estado de la sala. Si después de aplicarla el turno
 * queda en un bot, ejecuta los pasos de bots hasta que el turno sea humano
 * o la mano termine.
 *
 * Devuelve `true` si la acción era legal, `false` si no.
 */
export function applyAction(room: Room, seat: Seat, action: Parameters<typeof apply>[1]): boolean {
  if (room.state === null) return false;
  if (room.state.phase === 'finished') return false;
  if (room.state.turn !== seat) return false;
  const legal = legalActions(room.state, seat);
  if (!legal.some((a) => sameAction(a, action))) return false;
  try {
    apply(room.state, action);
  } catch {
    return false;
  }
  return true;
}

function sameAction(
  a: ReturnType<typeof legalActions>[number],
  b: ReturnType<typeof legalActions>[number],
): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'PLAY_CARD' && b.type === 'PLAY_CARD') return a.cardId === b.cardId;
  if (a.type === 'SING_CANTE' && b.type === 'SING_CANTE') return a.suit === b.suit;
  return true;
}

/**
 * Si el turno actual es de un bot, ejecuta acciones hasta que sea humano o
 * termine la mano. Entre cada paso de bot espera `delayMs` para que el
 * cliente pueda seguir la partida. Si una baza se resuelve, emite el evento
 * `TRICK_JUST_RESOLVED` y espera `trickPauseMs` para que el cliente vea las
 * 4 cartas.
 */
export async function stepBots(
  room: Room,
  delayMs = 1000,
  trickPauseMs = 2500,
): Promise<boolean> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let acted = false;
  let safety = 100;
  while (safety-- > 0) {
    if (room.state === null) return acted;
    if (room.state.phase === 'finished') return acted;
    const turn = room.state.turn;
    if (turn === null) return acted;
    const player = room.players[turn]!;
    if (player.token !== null) {
      // Turno de un humano: armar red de seguridad por si no actúa
      // en los próximos 10s. Hacemos esto aquí (no en un finally)
      // porque las salidas tempranas del while se saltan el
      // `scheduleAutoPlay` que va al final de la función.
      scheduleAutoPlay(room);
      return acted;
    }
    const before = room.state.finishedTricks.length;
    // Aplica la acción del bot por la MISMA ruta que las acciones
    // humanas: `applyActionWithResolveEvent`. Esto es clave porque
    // unifica los efectos colaterales: el broadcast de `SWAP_HAPPENED`
    // cuando un bot cambia el 7, el broadcast de `TRICK_JUST_RESOLVED`
    // cuando una baza termina, etc. Antes, los bots usaban
    // `stepHeuristicBot` que aplicaba el motor en crudo y se saltaba
    // esos broadcasts: por eso sólo se mostraba el aviso de cambio
    // del 7 cuando lo hacías TÚ, no cuando lo hacía un bot.
    const botAction = heuristicBotAction(room.state, turn);
    if (!botAction) return acted;
    const ok = applyActionWithResolveEvent(room, turn, botAction);
    if (!ok) return acted;
    acted = true;
    const after = room.state.finishedTricks.length;
    if (after > before) {
      const last = room.state.finishedTricks[after - 1]!;
      broadcastTrickResolved(room, last);
      // Si la mano termina, no emitimos GAME_OVER todavía: lo haremos
      // después de la pausa para que el cliente vea la última baza.
      emitAfterChange(room, { skipGameOver: last.hadLastTrick });
      await sleep(trickPauseMs);
      if (last.hadLastTrick) {
        emitAfterChange(room); // ahora sí, con GAME_OVER
        // Auto-cadencia: repartimos la siguiente mano tras una pausa
        // más larga (4,5 s) para que el jugador lea el panel de
        // resumen — sobre todo en los saltos entre idas/vueltas y
        // entre partidas, donde hay más info que procesar. Ver
        // comentario equivalente en `apps/server/src/index.ts`.
        setTimeout(() => triggerNextHand(room), 4500);
        return acted;
      }
    } else {
      emitAfterChange(room);
      await sleep(delayMs);
    }
  }
  // Tras la cadena de bots, si el turno quedó en un humano, armamos la
  // red de seguridad por si no actúa.
  scheduleAutoPlay(room);
  return acted;
}

/**
 * Llamado tras un cambio de estado (acción de humano o bots). Emite la vista
 * a todos. Si la mano terminó, también emite GAME_OVER (a menos que el
 * caller pase `skipGameOver: true` para emitirlo él mismo más tarde).
 *
 * La siguiente mano NO se reparte automáticamente: la dispara el cliente
 * con un mensaje NEXT_HAND (típicamente al pulsar "Continuar" en el panel
 * de resumen). Si la partida terminó (alguien alcanzó el umbral), incluye
 * `matchWinner` en el GAME_OVER y MATCH_OVER para el overlay de victoria.
 */
export function emitAfterChange(room: Room, opts: { skipGameOver?: boolean } = {}): void {
  broadcastView(room);
  if (room.state === null) return;
  if (room.state.phase === 'finished' && !opts.skipGameOver) {
    broadcastGameOver(room);
    if (room.state.matchEnded) {
      // Partida terminada — enviamos también MATCH_OVER para que el cliente
      // pueda mostrar un overlay dedicado de victoria.
      broadcastMatchOver(room);
    }
    // Si NO terminó la partida, la sala queda en pausa hasta que algún
    // cliente envíe NEXT_HAND. Ver `triggerNextHand`.
  }
}

/**
 * Dispara la siguiente mano: procesa la partida que acaba de terminar
 * (si matchEnded), actualiza el contador de partidas y posiblemente de
 * cotos, y luego reparte. Llamado desde el handler del mensaje NEXT_HAND
 * y desde la auto-cadencia del servidor.
 *
 * Reglas de progresión (partida → coto → match):
 *  - Si la partida actual terminó (matchEnded + matchWinner), el ganador
 *    recibe +1 partida. Si llega a 3 → gana el coto: +1 coto, reset
 *    partidas, siguiente coto. Si llega a 2 → matchFinished.
 *  - Si la partida NO terminó (falsa alarma) o seguimos en la misma
 *    partida, simplemente se reparte la siguiente mano con vuelta
 *    incrementada.
 *
 * No-op si el match ya terminó (matchFinished) o si no estamos en
 * `phase: 'finished'`.
 */
export function triggerNextHand(room: Room): void {
  // DEBUG: log temporal para diagnosticar por qué una mano a veces
  // no avanza al estado "Repartiendo siguiente mano…". Borrar tras
  // cerrar el ticket.
  if (room.matchFinished) {
    console.log(`[triggerNextHand] no-op: matchFinished=true code=${room.code}`);
    return;
  }
  if (room.state === null) return; // sala en lobby, no hay partida que avanzar
  if (room.state.phase !== 'finished') {
    console.log(`[triggerNextHand] no-op: phase=${room.state.phase} code=${room.code}`);
    return;
  }
  console.log(`[triggerNextHand] proceeding code=${room.code} vuelta=${room.state.vuelta} matchEnded=${room.state.matchEnded}`);

  // 1. Procesar la partida recién terminada, si la hay.
  if (room.state.matchEnded && room.state.matchWinner !== null) {
    const partidaWinner = room.state.matchWinner;
    room.partidas[partidaWinner]++;

    if (room.partidas[partidaWinner] >= 3) {
      // Coto ganado por partidaWinner
      room.cotos[partidaWinner]++;
      room.partidas = { 0: 0, 1: 0 };
      room.partidaEnCoto = 1;
      room.cotoEnMatch++;

      if (room.cotos[partidaWinner] >= 2) {
        // Match terminado: no se reparten más juegos. El cliente
        // mostrará el panel de "Match terminado" sin botón de continuar.
        room.matchFinished = true;
        room.matchChampion = partidaWinner;
        broadcastView(room);
        return;
      }
      // Coto ganado pero match no: cae al reparto de abajo (cae
      // sin return), para que el nuevo coto arranque sin click
      // del usuario.
    } else {
      // Siguiente partida del mismo coto
      room.partidaEnCoto++;
    }
  }

  // 2. Repartir la siguiente mano (siguiente vuelta del mismo juego, o
  // vuelta 1 del siguiente juego si el coto terminó por match end, o
  // vuelta 1 de la siguiente partida si la anterior la acaba de ganar
  // el mismo equipo).
  startNextHand(room);
  if (room.state.matchEnded) return;
  broadcastView(room);
  // Si el turno cae en un bot, arrancar automáticamente.
  void stepBots(room).catch(() => undefined);
  // Y si cae en un humano, armar la red de seguridad del auto-play.
  scheduleAutoPlay(room);
}

function broadcastGameOver(room: Room): void {
  if (room.state === null) return;
  const msg = {
    type: 'GAME_OVER',
    handPoints: { 0: room.state.trickPoints[0], 1: room.state.trickPoints[1] },
    gamePoints: { 0: room.state.trickPoints[0], 1: room.state.trickPoints[1] },
    score: { ...room.state.score },
    vuelta: room.state.vuelta,
    matchWinner: room.state.matchEnded ? room.state.matchWinner : null,
  } as any;
  broadcast(room, msg);
}

function broadcastMatchOver(room: Room): void {
  if (room.state === null) return;
  broadcast(room, {
    type: 'MATCH_OVER' as any,
    winner: room.state.matchWinner,
    score: room.state.score,
    vuelta: room.state.vuelta,
  } as any);
}

/**
 * Siguiente mano: baraja de nuevo y reparte la siguiente, conservando la
 * puntuación de la partida. Si la partida ya terminó, es un no-op.
 *
 * Regla del guiñote aragonés ("el que corta, reparte"): el dealer de la
 * siguiente mano es el ganador de la última baza de la mano anterior. La
 * regla vive en `nextDealer` del motor para que el cliente muestre el mismo
 * dealer en su hint.
 *
 * Vuelta: dentro de un mismo juego, la vuelta incrementa (ida → vuelta 1
 * → vuelta 2 …). Al cruzar el umbral, el juego termina y el siguiente
 * juego empieza en vuelta 1 (otra ida). Esto preserva la regla del
 * motor: cierre anticipado solo aplica con `vuelta > 1`.
 *
 * IMPORTANTE: esta función SIEMPRE reparte. Antes tenía un
 * `if (room.state.matchEnded) return;` que la bloqueaba cuando el juego
 * terminaba por match end. Con la nueva estructura (coto → partida →
 match), después de un coto el `triggerNextHand` ya decidió si repartir o
 * no; si llamó aquí, hay que repartir. El `triggerNextHand` se ocupa del
 * "no repartir más" cuando el match entero ha terminado (`room.matchFinished`).
 */
export function startNextHand(room: Room): void {
  if (room.state === null) return; // startNextHand asume state no-null; se llama solo desde triggerNextHand que ya lo garantiza
  const lastHandLastTrick = room.state.finishedTricks[room.state.finishedTricks.length - 1];
  const lastTrickWinner = lastHandLastTrick ? lastHandLastTrick.winner : null;
  const newDealer = nextDealer(lastTrickWinner, room.state.dealer);
  // Si el juego anterior terminó por match end → reset vuelta a 1.
  // Si fue una mano normal dentro del mismo juego → incrementa.
  const newVuelta = room.state.matchEnded ? 1 : room.state.vuelta + 1;
  room.state = newHand({
    id: `g-${room.code}-v${newVuelta}`,
    seed: cryptoToken(),
    rules: GUINOTE_ARAGONES,
    dealer: newDealer,
    continuation: {
      vuelta: newVuelta,
      score: room.state.score,
      // cumulativeTeamPts también se resetea: cada juego empieza con 0/0
      // (un coto = un juego = 0..100 raw, sin acumular entre cotos).
      cumulativeTeamPts: room.state.matchEnded
        ? { 0: 0, 1: 0 }
        : room.state.cumulativeTeamPts,
      matchEnded: false,
      matchWinner: null,
    },
  });
  room.seenCommandIds.clear();
}

/**
 * Comprueba si la partida ha terminado y emite el evento MATCH_OVER.
 * Llamar después de cada HAND_FINISHED en stepBots / applyAction.
 */
function checkMatchOver(room: Room): void {
  if (room.state === null) return;
  if (room.state.matchEnded && room.state.matchWinner !== null) {
    broadcast(room, {
      type: 'MATCH_OVER' as any,
      winner: room.state.matchWinner,
      score: room.state.score,
      vuelta: room.state.vuelta,
    } as any);
  }
}
