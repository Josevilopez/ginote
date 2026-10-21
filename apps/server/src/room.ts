import {
  apply,
  GUINOTE_ARAGONES,
  legalActions,
  newHand,
  type GameState,
  type Seat,
  type Play,
  viewFor,
  type PlayerView,
  type Card,
  type GameEvent,
  FIRST_TO_3,
  nextHandSetup,
  type MatchScoring,
  QUICK_FORMAT,
  isValidFormat,
  progressLeader,
  recordPartidaResult,
  type MatchFormat,
} from '@guinote/engine';
import { describeTable, nextStreak, recordResult, type MatchResult } from './results.js';
import { recordAbandon } from './abandons.js';
import { pairRepo, updatePairs, type PairMember, type PairSide } from './pairs.js';
import { botAction as decideBotAction, botThinkDelayMs, DEFAULT_BOT_LEVEL, heuristicBotAction, type BotLevel } from '@guinote/bots';
import { applyElo, applyEloTeam } from './elo.js';
import { updatePlayerRating } from './players.js';
import { getCosmosHandles } from './globalHandles.js';
import { forgetRoom, persistRoom } from './persistHooks.js';

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
import { divisionFor, rolloverSeason, seasonId, weekId, type Division, type SeasonBadge, type ServerMessage } from '@guinote/protocol';

export interface PlayerSlot {
  seat: Seat;
  /** Nombre visible (puede ser "Bot 2"). */
  name: string;
  /** null = bot. string = token de reconexión del cliente. */
  token: string | null;
  ws: WebSocket | null;
  /**
   * Flag interno que marca que el cliente envió un `LEAVE` antes de
   * que el WS cerrase. Lo usa el handler `socket.on('close')` para
   * distinguir un abandono intencional (LEAVE → liberar el slot
   * inmediatamente, sin backoff) de un drop accidental (WS closes
   * solo → backoff de 45 s antes de liberar el token por si el
   * cliente intenta reconectar). Sprint 2.12.
   */
  leaving?: boolean;
  /**
   * UUID de identidad anónima del jugador (cookie `guinote_pid` o
   * `?pid=<uuid>` del WS handshake). Se asigna en el WS handshake
   * y lo lee el hook de fin de mano de S2-17 para calcular ELO.
   * `undefined` = slot de bot (no juega ELO).
   */
  playerId?: string;
  /**
   * S2-12: `true` si este asiento era de un humano que abandonó (LEAVE a
   * mitad de partida) o no volvió en 45 s, y ahora lo juega un bot hasta
   * el final del match. No se puede reclamar.
   */
  substitute?: boolean;
  /** S2-15: epoch ms en que vence la ventana de reconexión (solo con ws caído). */
  reconnectDeadline?: number;
  /** S3-04: código del grupo de pareja (los dos se sientan en el mismo equipo). */
  partyCode?: string;
  /** S4-02: división (solo jugadores con cuenta y ya clasificados). */
  division?: Division;
  /**
   * S4-08: huella anónima de la conexión (HMAC de la IP con una sal de este
   * proceso; la IP no se guarda). Solo sirve para ver si dos rivales
   * juegan desde la misma conexión.
   */
  net?: string;
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

  // ─── Estructura del match completo (Sprint 2-13) ───
  // Decisión 2026-10-17: eliminar el concepto de "coto". Una partida
  // = una mano completa con su score de equipo. Gana el match el
  // primer equipo que llegue a 3 partidas (no 2 cotos de 3 partidas).
  //
  // Cuando termina una mano (state.matchEnded === true), se incrementa
  // matchWins[winner]. Si llega a 3, el match termina. Si no, se abre
  // un `postgame` de 20s para votar revancha: si todos votan yes, se
  // inicia una nueva partida; si alguien vota no o expira el timer,
  // se cierra el match con el equipo que tenga más matchWins.

  /** Partidas ganadas por equipo en este match. Gana el primero en llegar a 3. */
  matchWins: { 0: number; 1: number };
  /**
   * Estado de postgame: ventana de 20s con votación de revancha.
   * `null` cuando no estamos en postgame. Cuando se llena, se
   * decide si iniciar nueva partida (unanime yes) o cerrar el match.
   */
  postgame: {
    /** epoch ms del deadline (server time). */
    deadline: number;
    /** Voto de cada seat humano (los bots no votan, default 'pending' que cuenta como no). */
    votes: Record<number, 'pending' | 'yes' | 'no'>;
    /** Timer para cerrar el postgame si nadie vota o expira. */
    timer: NodeJS.Timeout | null;
  } | null;
  /** El match entero ha terminado (una pareja ha hecho 3 partidas). */
  matchFinished: boolean;
  /** Equipo ganador del match (0 o 1). null mientras no haya terminado, o si se cerró en empate. */
  matchChampion: 0 | 1 | null;
  /** Motivo del cierre del match (estado `closed`). null mientras siga abierto. */
  matchEndReason: MatchEndReason | null;
  /** S2-12: playerIds que abandonaron esta sala (no pueden volver a sentarse). */
  abandonedPlayerIds: Set<string>;
  /** S2-10: nivel de los bots de esta mesa (1 = fácil/aleatorio, 2 = heurístico). */
  botLevel: BotLevel;
  /**
   * S3-03: mesa privada. Sin cuenta atrás en el lobby (empieza el
   * anfitrión), fuera del matchmaking y sin ELO (partidas entre amigos).
   */
  isPrivate: boolean;
  /** S5-05: mesa de un cruce de torneo (sin bots de relleno, empieza con los 4, sin revancha). */
  tournament?: { torneoId: string; matchId: string; label: string };
  /**
   * S3-05: mesa formada por la cola de "Jugar online". Los asientos ya
   * están reservados; se reparte en cuanto conectan todos o al llegar
   * `deadline` (los que falten tienen la ventana normal de 45 s).
   */
  autoStart?: { deadline: number };
  /** S3-03: asiento del anfitrión (primer humano; si se va antes de empezar, el siguiente). */
  hostSeat: Seat | null;
  /**
   * S3-07: formato de la mesa. Partida rápida: 1 coto a 3 partidas.
   * Mesas privadas: lo elige el anfitrión (p. ej. match a 2 cotos).
   * `matchWins` = partidas del coto en curso; `cotoWins` = cotos ganados.
   */
  format: MatchFormat;
  cotoWins: { 0: number; 1: number };
}

export type MatchEndReason = 'won' | 'declined' | 'timeout' | 'abandoned';

/**
 * S2-12/S2-15: ventana para reconectar y recuperar el asiento tras una
 * caída del WS. Pasado este tiempo, un bot ocupa el asiento para siempre.
 * (45 s → 45 s el 2026-10-18.) El cliente usa el mismo valor en `store.ts`.
 */
export const RECONNECT_WINDOW_MS = 45_000;
/** Latido WS: ping cada N ms; si no llega el pong antes del siguiente, se corta. */
export const HEARTBEAT_MS = 5_000;

/**
 * S2-06: formato del match (regla en el motor, `matchScoring.ts`).
 * Partidas rápidas: primero a 3 partidas.
 */
export const MATCH_SCORING: MatchScoring = FIRST_TO_3;
/** @deprecated usar `MATCH_SCORING.winsToWin`. */
export const MATCH_WINS_TO_WIN = MATCH_SCORING.winsToWin;
/** Ventana de votacion de revancha: 20 segundos. */
export const REMATCH_VOTE_TIMEOUT_MS = 20_000;

/**
 * Crea una sala vacía. Los seats se rellenan al conectarse los clientes.
 * Para esta primera versión, el primer cliente en llegar toma seat 0; los
 * demás se asignan a slots libres (bots en modo `fillWithBots`).
 */
export function createRoom(opts: {
  code: string;
  fillWithBots?: boolean;
  botLevel?: BotLevel;
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
      players.push({ seat: s, name: botNames[s]!, token: null, ws: null, leaving: false });
    } else {
      players.push({ seat: s, name: '?', token: null, ws: null, leaving: false });
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
    matchWins: MATCH_SCORING.start(),
    postgame: null,
    matchFinished: false,
    matchChampion: null,
    matchEndReason: null,
    abandonedPlayerIds: new Set(),
    botLevel: opts.botLevel ?? DEFAULT_BOT_LEVEL,
    isPrivate: false,
    hostSeat: null,
    format: QUICK_FORMAT,
    cotoWins: { 0: 0, 1: 0 },
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
        matchWins: room.matchWins,
        cotoWins: room.cotoWins,
        format: room.format,
        matchFinished: room.matchFinished,
        matchChampion: room.matchChampion,
      } satisfies ServerMessage));
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
    isPrivate: room.isPrivate,
    hostSeat: room.hostSeat,
    ...(room.tournament ? { tournament: room.tournament.label } : {}),
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
  if (room.tournament) {
    // S5-05: cruce de torneo. Sin cuenta atrás ni bots: se reparte cuando
    // están los cuatro sentados y conectados.
    clearLobbyTimer(room);
    room.lobbyEndsAt = null;
    const all = room.players.every((p) => p.token !== null && p.ws !== null && p.ws.readyState === 1);
    if (all) {
      startMatchAndDeal(room);
      return;
    }
    broadcastLobbyStatus(room);
    return;
  }
  if (room.isPrivate) {
    // S3-03: en la mesa privada no hay cuenta atrás ni arranque
    // automático; solo se asegura que haya anfitrión y se avisa a todos.
    clearLobbyTimer(room);
    ensureHost(room);
    broadcastLobbyStatus(room);
    return;
  }
  if (room.autoStart) {
    // S3-05: mesa de la cola. Se reparte cuando estén todos conectados
    // o al vencer el plazo; los huecos ya son de bots.
    clearLobbyTimer(room);
    const waiting = room.players.some((p) => p.token !== null && p.ws === null);
    const left = room.autoStart.deadline - Date.now();
    if (!waiting || left <= 0) {
      startMatchAndDeal(room);
      return;
    }
    room.lobbyEndsAt = room.autoStart.deadline;
    room.lobbyTimer = setTimeout(() => {
      room.lobbyTimer = null;
      if (room.state === null) startMatchAndDeal(room);
    }, left);
    broadcastLobbyStatus(room);
    return;
  }
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
        // Mismo token que ya tenía asignado. El cliente lo ignora si
        // ya lo tenía guardado; si no, lo aprende. Re-conexiones futuras
        // usarán este token para reclamar el seat.
        token: p.token ?? '',
      } satisfies ServerMessage));
    }
  }
  // broadcastView hace el trabajo: salta automáticamente si state === null,
  // pero aquí ya es no-null. stepBots arranca por si el primer turno
  // cae en un bot (mesa recién creada con dealer aleatorio).
  broadcastView(room);
  broadcastSeats(room); // S4-02: divisiones de los que ya estaban sentados
  persistRoom(room, 'reparto');
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
  const player = room.players[turn]!;
  if (player.token === null) return; // es un bot, los bots no necesitan red de seguridad
  // S2-12: si el humano está desconectado (en la ventana de reconexión) no
  // tiene sentido esperarle 10 s por turno: juega el auto-play a los 2 s.
  if (player.ws === null) delayMs = Math.min(delayMs, 2_000);
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
function broadcastTrickResolved(
    room: Room,
    trick: { winner: Seat; plays: readonly Play[]; trickPoints: number; hadLastTrick: boolean; isArrastreEntrance: boolean; isLastTrick: boolean },
  ): void {
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'TRICK_JUST_RESOLVED',
        winner: trick.winner,
        plays: trick.plays.map((pl) => ({ seat: pl.seat, card: pl.card })),
        points: trick.trickPoints,
        // Sprint 2.22: usar `trick.isLastTrick` (calculado por el motor:
        // true SOLO si la baza es la última REAL de la mano) en lugar
        // de `trick.hadLastTrick` (que también es true en cierres
        // anticipados por match cut). Esto evita que el cliente pinte
        // el overlay "¡10 de últimas!" en una baza intermedia cuando
        // se cortó la mano por alcanzarse el umbral temprano.
        isLastTrick: trick.isLastTrick,
        isArrastreEntrance: trick.isArrastreEntrance,
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
  // Capturamos el estado de `matchEnded` ANTES de aplicar la acción
  // para detectar la transición a "fin de partida" y disparar el hook
  // de ELO (S2-17). Si `matchEnded` pasa de false a true en esta
  // acción, calculamos y persistimos los nuevos ratings.
  const matchEndedBefore = room.state.matchEnded;
  const phaseBefore = room.state.phase;
  const ok = applyAction(room, seat, action);
  if (!ok) return false;
  // S2-14: snapshot al final de cada mano (por baza o cortada por cante).
  if (phaseBefore !== 'finished' && room.state.phase === 'finished') persistRoom(room, 'fin de mano');
  const matchEndedAfter = room.state.matchEnded;
  if (!matchEndedBefore && matchEndedAfter && room.state.matchWinner !== null) {
    // Hook S2-17: actualizar ELO de los humanos al final de la partida.
    // Fire-and-forget: no bloqueamos la respuesta de la acción al cliente.
    void updateEloOnHandEnd(room, room.state.matchWinner);
    // S5-04: avisar a quien escuche (retos entre peñas). También mesas privadas.
    notifyPartidaEnd(room, room.state.matchWinner);
  }
  const after = room.state.finishedTricks.length;
  if (after > before) {
    const last = room.state.finishedTricks[after - 1]!;
    broadcastTrickResolved(room, last);
  } else if (room.state.phase === 'finished') {
    // La mano se cerró SIN baza: un cante en vueltas que cruza el umbral
    // (el motor corta la mano en `apply`). Los callers solo programan
    // `triggerNextHand` cuando resuelve la última baza, así que aquí no
    // lo haría nadie y la mesa se quedaba congelada en "Contando la
    // partida…". Misma pausa que tras la última baza.
    console.log(`[hand] cerrada por cante code=${room.code} → triggerNextHand en 4,5 s`);
    setTimeout(() => triggerNextHand(room), 4500);
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
  // S2-10: sin valor → "tiempo de pensar" aleatorio de 600-1500 ms por acción.
  delayMs?: number,
  trickPauseMs = 2000,
  // Sprint 2.19: pausa extra larga cuando la baza resuelta es la
  // última de la mano. Da tiempo al usuario a leer la jugada final
  // (incluido el "10 de últimas" si aplica) antes de que se emita
  // el GAME_OVER y le tape el panel de resumen. Antes era 2,5 s
  // para todas las bazas — el usuario reportó que la última se
  // sentía demasiado rápida al pasar al resumen.
  lastTrickPauseMs = 3000,
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
    const botAction = decideBotAction(room.state, turn, room.botLevel);
    if (!botAction) return acted;
    // Sprint 2.15+: log adicional para confirmar qué decidió el bot
    // ante el filtro del motor. Útil cuando un usuario reporta "el bot
    // hizo un cambio ilegal": aquí vemos literalmente qué acción
    // eligió la heurística y por qué.
    console.log(`[BOT] code=${room.code} seat=${turn} action=${JSON.stringify(botAction)} trumpCard=${room.state.trumpCard?.id ?? 'null'}`);
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
      // Sprint 2.19: pausa extra larga si la baza resuelta es la última
      // de la mano, para que el jugador pueda leer la jugada final
      // (incluido el "10 de últimas" si aplica) antes de que aparezca
      // el GAME_OVER.
      const pause = last.hadLastTrick ? lastTrickPauseMs : trickPauseMs;
      await sleep(pause);
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
      await sleep(delayMs ?? botThinkDelayMs());
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
 * (si matchEnded), actualiza `matchWins`, y luego reparte. Llamado
 * desde el handler del mensaje NEXT_HAND y desde la auto-cadencia
 * del servidor.
 *
 * Reglas de progresión (Sprint 2-13, 2026-10-17):
 *  - Si la mano actual terminó (`state.matchEnded + matchWinner`), el
 *    ganador recibe +1 partida (`matchWins[winner]++`).
 *  - Si `matchWins[winner] >= 3` → match termina con ese ganador.
 *  - Si `matchWins[winner] < 3` → se abre `postgame` de 20s con
 *    votación de revancha. Si todos los humanos votan `yes` antes
 *    del deadline, se inicia nueva partida (mismos seats, nuevo
 *    `matchWins` no, se mantiene). Si expira o alguien vota `no`,
 *    se cierra el match con el que tenga más `matchWins` (o empate).
 *  - Si la mano NO terminó, simplemente se reparte la siguiente
 *    mano con vuelta incrementada.
 *
 * No-op si el match ya terminó (`matchFinished`) o si no estamos en
 * `phase: 'finished'`.
 */
export function triggerNextHand(room: Room): void {
  if (room.matchFinished) {
    console.log(`[triggerNextHand] no-op: matchFinished=true code=${room.code}`);
    return;
  }
  // Ya hay una votación de revancha abierta: la partida terminada ya se
  // contó en `matchWins`. Sin este guard, la auto-cadencia (setTimeout
  // 4,5 s) + un NEXT_HAND del cliente sumarían la misma partida 2 veces.
  if (room.postgame !== null) {
    console.log(`[triggerNextHand] no-op: postgame abierto code=${room.code}`);
    return;
  }
  if (room.state === null) return; // sala en lobby, no hay partida que avanzar
  if (room.state.phase !== 'finished') {
    console.log(`[triggerNextHand] no-op: phase=${room.state.phase} code=${room.code}`);
    return;
  }
  console.log(`[triggerNextHand] proceeding code=${room.code} vuelta=${room.state.vuelta} matchEnded=${room.state.matchEnded}`);

  // 1. Procesar la mano recién terminada, si la hay.
  if (room.state.matchEnded && room.state.matchWinner !== null) {
    const winner = room.state.matchWinner;
    // S3-07: partidas del coto + cotos del match según el formato de la mesa.
    const r = recordPartidaResult({ partidas: room.matchWins, cotos: room.cotoWins }, winner, room.format);
    room.matchWins = r.progress.partidas;
    room.cotoWins = r.progress.cotos;
    if (r.matchWinner !== null) {
      // S5-05: en un cruce de torneo no hay revancha: se cierra y cuenta.
      if (room.tournament) {
        closeMatch(room, r.matchWinner, 'won');
        return;
      }
      // S3-06: se acabó la mesa (el coto en partida rápida, o el match a N
      // cotos en privada) → AHORA se pregunta la revancha.
      openPostgame(room);
      return;
    }
    if (r.cotoWinner !== null) {
      // S3-07: coto ganado sin acabar el match → siguiente coto desde 0-0,
      // sin votación.
      console.log(`[coto] coto para team ${r.cotoWinner} code=${room.code} cotos=${JSON.stringify(room.cotoWins)} → siguiente coto`);
      dealAndResume(room);
      return;
    }
    // S3-06: coto en curso → siguiente partida directamente, sin votación
    // (antes se votaba revancha tras cada partida).
    console.log(`[coto] partida para team ${winner} code=${room.code} matchWins=${JSON.stringify(room.matchWins)} → siguiente partida`);
    dealAndResume(room);
    return;
  }

  // 2. Repartir la siguiente mano (siguiente vuelta del mismo juego).
  dealAndResume(room);
}

/** Reparte la siguiente mano, emite VIEW y arranca bots / auto-play. */
function dealAndResume(room: Room): void {
  startNextHand(room);
  broadcastView(room);
  persistRoom(room, 'reparto');
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
  // S2-06: dealer y continuación (misma partida o partida nueva) los
  // decide el motor (`nextHandSetup`).
  const { dealer, continuation } = nextHandSetup(room.state);
  room.state = newHand({
    id: `g-${room.code}-v${continuation.vuelta}`,
    seed: cryptoToken(),
    rules: GUINOTE_ARAGONES,
    dealer,
    continuation,
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

/**
 * Abre la ventana de postgame: votación de revancha de 20s AL ACABAR EL
 * COTO (S3-06; antes se abría tras cada partida). Si todos los humanos
 * votan `yes` antes del deadline, empieza un coto nuevo desde 0-0. Si
 * expira o alguien vota `no`, se cierra la mesa.
 *
 * Los bots votan `yes` automáticamente (no bloquean la revancha). Si no
 * queda ningún humano en la mesa, la revancha no tiene sentido y se
 * cierra el match directamente.
 */
function openPostgame(room: Room): void {
  clearAutoPlayTimer(room);
  const humanSeats = room.players.filter((p) => p.token !== null).map((p) => p.seat);
  if (humanSeats.length === 0) {
    closeMatch(room, leaderByMatchWins(room), 'abandoned');
    return;
  }
  const deadline = Date.now() + REMATCH_VOTE_TIMEOUT_MS;
  const votes: Record<number, 'pending' | 'yes' | 'no'> = {};
  for (const p of room.players) votes[p.seat] = p.token === null ? 'yes' : 'pending';
  const timer = setTimeout(() => {
    if (room.postgame) room.postgame.timer = null;
    resolvePostgame(room, 'timeout');
  }, REMATCH_VOTE_TIMEOUT_MS);
  room.postgame = { deadline, votes, timer };
  persistRoom(room, 'votación de revancha');
  broadcastRematchStatus(room);
  console.log(`[postgame] opened code=${room.code} matchWins=${JSON.stringify(room.matchWins)}`);
}

/** Mensaje REMATCH_STATUS con el estado actual de la votación (o null si no hay postgame). */
function rematchStatusMessage(room: Room): ServerMessage | null {
  if (!room.postgame) return null;
  return {
    type: 'REMATCH_STATUS',
    deadline: room.postgame.deadline,
    votes: serializeVotes(room.postgame.votes),
    matchWins: room.matchWins,
    cotoWins: room.cotoWins,
  };
}

function broadcastRematchStatus(room: Room): void {
  const msg = rematchStatusMessage(room);
  if (msg) broadcast(room, msg);
}

/**
 * Para un cliente que (re)conecta: si la sala está en postgame le manda
 * el REMATCH_STATUS vigente; si el match ya se cerró, el MATCH_ENDED.
 */
export function sendPostgameStateTo(room: Room, ws: { send: (data: string) => void; readyState: number }): void {
  if (ws.readyState !== 1) return;
  const status = rematchStatusMessage(room);
  if (status) {
    ws.send(JSON.stringify(status));
    return;
  }
  if (room.matchFinished && room.matchEndReason !== null) {
    ws.send(JSON.stringify({
      type: 'MATCH_ENDED',
      winner: room.matchChampion,
      reason: room.matchEndReason,
      matchWins: room.matchWins,
      cotoWins: room.cotoWins,
    } satisfies ServerMessage));
  }
}

/** Convierte el Record<number, vote> a Record<string, vote> para zod. */
function serializeVotes(votes: Record<number, 'pending' | 'yes' | 'no'>): Record<string, 'pending' | 'yes' | 'no'> {
  const out: Record<string, 'pending' | 'yes' | 'no'> = {};
  for (const k of Object.keys(votes)) out[k] = votes[Number(k)]!;
  return out;
}

/** Equipo con más `matchWins`, o `null` si van empatados. */
function leaderByMatchWins(room: Room): 0 | 1 | null {
  return progressLeader({ partidas: room.matchWins, cotos: room.cotoWins });
}

/**
 * Cierra el match (estado `closed`). `winner` es el equipo campeón o
 * `null` si se cerró en empate. Tras esto la sala ya no reparte más.
 */
function closeMatch(room: Room, winner: 0 | 1 | null, reason: MatchEndReason): void {
  if (room.postgame?.timer) clearTimeout(room.postgame.timer);
  room.postgame = null;
  clearAutoPlayTimer(room);
  room.matchFinished = true;
  room.matchChampion = winner;
  room.matchEndReason = reason;
  broadcastView(room);
  broadcast(room, {
    type: 'MATCH_ENDED',
    winner,
    reason,
    matchWins: room.matchWins,
    cotoWins: room.cotoWins,
  });
  console.log(`[match] ended code=${room.code} reason=${reason} champion=${winner ?? 'empate'} matchWins=${JSON.stringify(room.matchWins)}`);
  forgetRoom(room.code); // S2-14: match cerrado → nada que rehidratar
  // S5-05: quien escuche (torneos).
  const e: MatchEnd = { code: room.code, winner, reason, matchWins: { ...room.matchWins } };
  if (room.tournament) e.tournament = room.tournament;
  for (const fn of matchEndListeners) fn(e).catch((err) => console.log(`[match] listener falló: ${(err as Error).message}`));
}

export interface MatchEnd {
  code: string;
  winner: 0 | 1 | null;
  reason: MatchEndReason;
  matchWins: { 0: number; 1: number };
  tournament?: { torneoId: string; matchId: string; label: string };
}
const matchEndListeners: ((e: MatchEnd) => Promise<unknown>)[] = [];
/** S5-05: avisa al cerrarse cada mesa (fin del match). */
export function onMatchEnd(fn: (e: MatchEnd) => Promise<unknown>): void {
  matchEndListeners.push(fn);
}

/** ¿Todos los humanos sentados han votado `yes`? */
function allHumansYes(room: Room): boolean {
  const pg = room.postgame;
  if (!pg) return false;
  return room.players.every((p) => p.token === null || pg.votes[p.seat] === 'yes');
}

/**
 * Resuelve el postgame: unanimidad de humanos en `yes` → nueva partida
 * (mismos seats, dealer rotado, mazo nuevo, `matchWins` se conserva).
 * Cualquier otra cosa → match cerrado con el que lleve más `matchWins`.
 */
function resolvePostgame(room: Room, reasonIfClosed: MatchEndReason): void {
  const pg = room.postgame;
  if (!pg) return;
  if (allHumansYes(room)) {
    if (pg.timer) clearTimeout(pg.timer);
    room.postgame = null;
    // S3-06/S3-07: revancha = coto (o match) nuevo desde 0-0 en la misma mesa.
    room.matchWins = { 0: 0, 1: 0 };
    room.cotoWins = { 0: 0, 1: 0 };
    console.log(`[postgame] revancha aceptada code=${room.code} → coto nuevo`);
    dealAndResume(room);
    return;
  }
  closeMatch(room, leaderByMatchWins(room), reasonIfClosed);
}

/**
 * Procesa un voto de revancha desde el cliente. Un `no` cierra el match
 * al instante; si tras el voto todos los humanos son `yes`, arranca la
 * nueva partida sin esperar al deadline. Devuelve `false` si no había
 * votación abierta (o el seat no es humano).
 */
export function castRematchVote(room: Room, seat: Seat, accept: boolean): boolean {
  if (!room.postgame) return false;
  if (room.players[seat]?.token == null) return false;
  room.postgame.votes[seat] = accept ? 'yes' : 'no';
  broadcastRematchStatus(room);
  if (!accept) {
    resolvePostgame(room, 'declined');
  } else if (allHumansYes(room)) {
    resolvePostgame(room, 'timeout');
  }
  return true;
}

/**
 * Un humano abandona la mesa (LEAVE) durante el postgame: cuenta como
 * voto `no` → la mesa se cierra (S2-13 punto 5).
 */
export function abandonDuringPostgame(room: Room, seat: Seat): void {
  if (!room.postgame) return;
  room.postgame.votes[seat] = 'no';
  broadcastRematchStatus(room);
  resolvePostgame(room, 'abandoned');
}

// ─────────────── S3-03: mesas privadas ───────────────

/** El anfitrión es el primer humano sentado; si se va antes de empezar, pasa al siguiente. */
export function ensureHost(room: Room): void {
  const current = room.hostSeat !== null ? room.players[room.hostSeat] : undefined;
  if (current && current.token !== null) return;
  const next = room.players.find((p) => p.token !== null);
  room.hostSeat = next ? next.seat : null;
}

/**
 * Mueve al jugador entero (nombre, token, conexión, identidad, pareja)
 * del asiento `a` al `b` y viceversa. Solo antes de repartir. No avisa:
 * el llamador emite `broadcastSeatsChanged` cuando termine.
 */
export function swapSeatFields(room: Room, a: Seat, b: Seat): void {
  if (a === b) return;
  const pa = room.players[a]!;
  const pb = room.players[b]!;
  const fields = ['name', 'token', 'ws', 'leaving', 'playerId', 'reconnectDeadline', 'partyCode', 'division', 'net'] as const;
  for (const f of fields) {
    const tmp = (pa as unknown as Record<string, unknown>)[f];
    const other = (pb as unknown as Record<string, unknown>)[f];
    if (other === undefined) delete (pa as unknown as Record<string, unknown>)[f];
    else (pa as unknown as Record<string, unknown>)[f] = other;
    if (tmp === undefined) delete (pb as unknown as Record<string, unknown>)[f];
    else (pb as unknown as Record<string, unknown>)[f] = tmp;
  }
  if (room.hostSeat === a) room.hostSeat = b;
  else if (room.hostSeat === b) room.hostSeat = a;
}

/**
 * S3-04/S3-05: reserva un asiento para alguien que aún no ha conectado
 * (pareja o cola). Devuelve el token con el que entrará su WebSocket.
 * Si no llega en 45 s, el asiento se libera (lobby) o lo toma un bot.
 */
export function reserveSeat(
  room: Room,
  seat: Seat,
  who: { name: string; playerId?: string | null; partyCode?: string },
): string {
  const slot = room.players[seat]!;
  const token = cryptoToken();
  slot.token = token;
  slot.name = who.name;
  slot.ws = null;
  if (who.playerId) slot.playerId = who.playerId;
  else delete slot.playerId;
  if (who.partyCode) slot.partyCode = who.partyCode;
  else delete slot.partyCode;
  markDisconnected(room, seat, { rescheduleAutoPlay: false });
  return token;
}

/** Reenvía WELCOME a cada humano (su asiento puede haber cambiado) + LOBBY_STATUS. */
export function broadcastSeatsChanged(room: Room): void {
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1 && p.token !== null) {
      p.ws.send(JSON.stringify({
        type: 'WELCOME',
        you: p.seat,
        roomCode: room.code,
        seatNames: room.players.map((pl) => pl.name),
        isBot: room.players.map((pl) => pl.token === null),
        token: p.token,
      } satisfies ServerMessage));
    }
  }
  broadcastLobbyStatus(room);
}

/**
 * S3-03: el anfitrión intercambia dos asientos (así elige las parejas:
 * 0-2 contra 1-3). Solo en mesa privada sin empezar. Se mueve al jugador
 * entero (nombre, token, conexión, identidad); el número de asiento es
 * el de la silla. Devuelve un mensaje de error o `null` si fue bien.
 */
export function swapPrivateSeats(room: Room, bySeat: Seat, a: Seat, b: Seat): string | null {
  if (!room.isPrivate) return 'Solo en mesas privadas';
  if (room.state !== null) return 'La partida ya ha empezado';
  if (room.hostSeat !== bySeat) return 'Solo el anfitrión puede mover a los jugadores';
  if (a === b) return null;
  swapSeatFields(room, a, b);
  console.log(`[private] code=${room.code} asientos ${a}↔${b} (anfitrión=${room.hostSeat})`);
  broadcastSeatsChanged(room);
  return null;
}

/**
 * S3-03: el anfitrión empieza la partida. Los huecos se completan con
 * bots del nivel elegido (1 fácil, 2 normal).
 */
export function startPrivate(room: Room, bySeat: Seat, botLevel: BotLevel, format: MatchFormat = QUICK_FORMAT): string | null {
  if (!room.isPrivate) return 'Solo en mesas privadas';
  if (room.state !== null) return 'La partida ya ha empezado';
  if (room.hostSeat !== bySeat) return 'Solo el anfitrión puede empezar';
  if (!isValidFormat(format)) return 'Formato de partida no válido';
  room.botLevel = botLevel;
  room.format = format; // S3-07
  console.log(`[private] code=${room.code} empieza (bots nivel ${botLevel})`);
  startMatchAndDeal(room);
  return null;
}

// ─────────────── S2-12: desconexión y sustitución por bot ───────────────

export type SeatKind = 'human' | 'disconnected' | 'bot' | 'substitute';

/** Estado visible de cada asiento (para el mensaje SEATS). */
export function seatKinds(room: Room): SeatKind[] {
  return room.players.map((p) => {
    if (p.token === null) return p.substitute ? 'substitute' : 'bot';
    return p.ws && p.ws.readyState === 1 ? 'human' : 'disconnected';
  });
}

/** Emite SEATS a todos los humanos conectados. No-op en lobby (lo cubre LOBBY_STATUS). */
export function broadcastSeats(room: Room): void {
  if (room.state === null) return;
  broadcast(room, {
    type: 'SEATS',
    seatNames: room.players.map((p) => p.name),
    seatKinds: seatKinds(room),
    reconnectDeadlines: room.players.map((p) =>
      p.token !== null && p.ws === null && p.reconnectDeadline !== undefined ? p.reconnectDeadline : null,
    ),
    seatDivisions: room.players.map((p) => (p.token !== null ? (p.division ?? null) : null)),
  });
}

/**
 * S4-02: lee de Cosmos la división del jugador sentado en `seat` (solo si
 * tiene cuenta y ha jugado las partidas de clasificación) y la reparte.
 */
export async function loadSeatDivision(room: Room, seat: Seat): Promise<void> {
  const slot = room.players[seat];
  const cosmos = getCosmosHandles();
  if (!slot?.playerId || !cosmos) return;
  const pid = slot.playerId;
  try {
    const { resource } = await cosmos.players.item(pid, pid).read();
    const r = resource as { rating?: number; games?: number; userId?: string; seasonId?: string; seasonPeak?: number; seasonBadges?: SeasonBadge[] } | undefined;
    if (room.players[seat]?.playerId !== pid) return; // cambió de dueño mientras leíamos
    const d = r?.userId ? divisionFor(seasonStart(r).rating, r.games ?? 0) : null;
    if (d) slot.division = d;
    else delete slot.division;
    broadcastSeats(room);
  } catch {
    // Sin división: no pasa nada.
  }
}

/**
 * ¿Hay una partida en juego? (no en lobby, no entre partidas esperando
 * revancha, no con el match cerrado). Abandonar en este estado cuenta
 * como derrota para ELO.
 */
export function isMidPartida(room: Room): boolean {
  return room.state !== null && !room.matchFinished && !room.state.matchEnded && room.postgame === null;
}

const teamOfSeat = (seat: number): 0 | 1 => (seat % 2 === 0 ? 0 : 1);

/**
 * S2-12: un bot toma DEFINITIVAMENTE el asiento de un humano, porque
 * abandonó (LEAVE) o porque pasaron 45 s sin reconectar. Decisiones
 * (2026-10-18):
 *  - No se puede reclamar: el token se invalida y el asiento queda como
 *    `substitute` hasta el final del match.
 *  - Si ocurre a mitad de partida, cuenta como DERROTA de ELO para quien
 *    abandona (contra el rating medio de los rivales humanos; si no hay
 *    rivales humanos no cuenta, igual que las partidas contra bots).
 *  - El `playerId` se borra del asiento: el hook de fin de partida ya no
 *    lo verá (no se le penaliza dos veces ni hereda nadie su ELO).
 */
export function substituteWithBot(room: Room, seat: Seat, reason: 'leave' | 'timeout'): void {
  const p = room.players[seat];
  if (!p || p.token === null) return;
  // S3-03: en mesas privadas no hay ELO, tampoco derrota por abandono.
  const penalize = isMidPartida(room) && p.playerId !== undefined && !room.isPrivate;
  const abandoner = penalize ? { playerId: p.playerId!, team: teamOfSeat(seat), table: describeTable(room, seat) } : null;
  // Rivales humanos en este momento (para el ELO del abandono).
  const opponents = room.players
    .filter((o) => o.token !== null && o.playerId && teamOfSeat(o.seat) !== teamOfSeat(seat))
    .map((o) => o.playerId!);

  if (p.playerId) room.abandonedPlayerIds.add(p.playerId);
  p.token = null;
  p.ws = null;
  p.leaving = false;
  delete p.playerId;
  delete p.reconnectDeadline;
  delete p.division;
  delete p.net;
  p.substitute = true;
  // El nombre se conserva: la UI marca el asiento con "🤖 bot" (SEATS.seatKinds).
  console.log(`[seat] code=${room.code} seat=${seat} sustituido por bot (${reason}) penaliza=${penalize}`);
  persistRoom(room, 'sustitución'); // si no, tras un reinicio se le volvería a penalizar
  broadcastSeats(room);

  if (abandoner) void penalizeAbandon(room, abandoner.playerId, opponents, abandoner.table);

  // Postgame: el bot sustituto vota yes; si con eso hay unanimidad, resolver.
  if (room.postgame) {
    room.postgame.votes[seat] = 'yes';
    broadcastRematchStatus(room);
    if (allHumansYes(room)) resolvePostgame(room, 'timeout');
    return;
  }
  // Si le tocaba a él, el bot juega ya (sin esperar al auto-play).
  if (room.state && room.state.phase !== 'finished' && room.state.turn === seat) {
    clearAutoPlayTimer(room);
    void stepBots(room).catch(() => undefined);
  }
}

/**
 * S2-12/S2-15: el WS de un humano se ha caído (o el server se ha
 * reiniciado). Abre la ventana de reconexión (45 s): si no vuelve con su
 * token, un bot ocupa el asiento para siempre (o, en lobby, se libera).
 * `rescheduleAutoPlay`: si le tocaba, su turno se juega a los 2 s.
 */
export function markDisconnected(room: Room, seat: Seat, opts: { rescheduleAutoPlay?: boolean } = {}): void {
  const p = room.players[seat];
  if (!p || p.token === null) return;
  p.ws = null;
  p.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
  broadcastSeats(room); // S2-15: los demás ven "desconectado"
  if (opts.rescheduleAutoPlay !== false && room.state !== null && room.state.turn === seat) scheduleAutoPlay(room);
  const tokenAtClose = p.token;
  setTimeout(() => {
    const now = room.players[seat];
    if (!now) return;
    // Sigue sin reconectar y el asiento es del MISMO jugador (no lo ha
    // ocupado otro humano en el lobby mientras tanto).
    if (now.ws !== null || now.token === null || now.token !== tokenAtClose) return;
    if (room.state === null) {
      now.token = null;
      now.name = '?';
      delete now.playerId;
      delete now.partyCode;
      delete now.division;
      delete now.net;
      delete now.reconnectDeadline;
      scheduleLobbyCheck(room);
    } else if (!room.matchFinished) {
      // S2-12: 45 s sin volver → bot definitivo (sin reclamar).
      substituteWithBot(room, seat, 'timeout');
    }
  }, RECONNECT_WINDOW_MS);
}

/** Margen tras rehidratar antes de reanudar bots / auto-play, para que los clientes reconecten. */
export const RESUME_GRACE_MS = 8_000;

/**
 * S2-14: reanuda una sala recién rehidratada desde Cosmos tras un
 * reinicio. Todos los humanos empiezan desconectados con su ventana de
 * 45 s (sus clientes ya reintentan solos con el token, S2-15). Tras un
 * margen de 8 s:
 *  - match cerrado → nada;
 *  - había votación de revancha → se reabre con 20 s nuevos;
 *  - mano terminada → se sigue con la siguiente (o se abre la votación);
 *  - mano en curso (snapshot del reparto) → se juega desde ahí.
 */
export function resumeRestoredRoom(room: Room, opts: { postgameOpen: boolean }): void {
  for (const p of room.players) {
    if (p.token !== null) markDisconnected(room, p.seat, { rescheduleAutoPlay: false });
  }
  setTimeout(() => {
    if (room.matchFinished || room.state === null) return;
    if (opts.postgameOpen) {
      openPostgame(room);
      return;
    }
    if (room.state.phase === 'finished') {
      triggerNextHand(room);
      return;
    }
    broadcastView(room);
    void stepBots(room).catch(() => undefined);
    scheduleAutoPlay(room);
  }, RESUME_GRACE_MS);
}

/**
 * ELO del abandono: derrota (score 0) del que se va contra el rating
 * medio de los rivales humanos. Fire-and-forget, como el hook de fin de
 * partida.
 */
/**
 * S4-09: temporada del jugador antes de la partida (aplica el cambio de
 * temporada si toca) y campos a guardar después.
 */
function seasonStart(doc: { rating?: number; games?: number; seasonId?: string | undefined; seasonPeak?: number | undefined; seasonBadges?: SeasonBadge[] | undefined }) {
  const rating = doc.rating ?? 1000;
  const roll = rolloverSeason({ rating, games: doc.games ?? 0, seasonId: doc.seasonId, seasonPeak: doc.seasonPeak, seasonBadges: doc.seasonBadges });
  return {
    rating: roll?.rating ?? rating,
    peak: roll?.seasonPeak ?? doc.seasonPeak ?? rating,
    badges: roll?.seasonBadges ?? doc.seasonBadges ?? [],
  };
}
function seasonPatch(start: { peak: number; badges: SeasonBadge[] }, newRating: number) {
  return { seasonId: seasonId(), seasonPeak: Math.max(start.peak, newRating), seasonBadges: start.badges };
}

/** S4-06: suma una partida y sus puntos a la semana en curso (reinicia si cambió de semana). */
function weekPatch(doc: { weekId?: string | undefined; weekPoints?: number | undefined; weekGames?: number | undefined }, delta: number) {
  const week = weekId();
  const same = doc.weekId === week;
  return { weekId: week, weekPoints: (same ? (doc.weekPoints ?? 0) : 0) + delta, weekGames: (same ? (doc.weekGames ?? 0) : 0) + 1 };
}

async function penalizeAbandon(
  room: Room,
  playerId: string,
  opponentIds: string[],
  table: Pick<MatchResult, 'kind' | 'mate' | 'rivals'>,
): Promise<void> {
  const cosmos = getCosmosHandles();
  if (!cosmos) return;
  if (opponentIds.length === 0) {
    console.log(`[elo] abandono code=${room.code} ${playerId.slice(0, 8)}: sin rivales humanos, no cuenta`);
    return;
  }
  type Doc = { rating?: number; games?: number; wins?: number; losses?: number; streak?: number; bestStreak?: number; weekId?: string; weekPoints?: number; weekGames?: number; abandons?: string[]; queueBanUntil?: string; seasonId?: string; seasonPeak?: number; seasonBadges?: SeasonBadge[] };
  const read = async (id: string): Promise<Doc | null> => {
    try {
      const { resource } = await cosmos.players.item(id, id).read();
      return (resource as Doc | undefined) ?? null;
    } catch (err) {
      console.log(`[elo] error leyendo player ${id}: ${(err as Error).message}`);
      return null;
    }
  };
  const me = await read(playerId);
  if (!me) return;
  const opp = (await Promise.all(opponentIds.map(read))).filter((d): d is Doc => d !== null);
  if (opp.length === 0) return;
  const oppRating = opp.reduce((a, d) => a + (d.rating ?? 1000), 0) / opp.length;
  const season = seasonStart(me); // S4-09
  const rating = season.rating;
  const games = me.games ?? 0;
  const { deltaA } = applyElo(rating, oppRating, 0, games);
  try {
    await updatePlayerRating(cosmos, playerId, {
      rating: rating + deltaA,
      games: games + 1,
      wins: me.wins ?? 0,
      losses: (me.losses ?? 0) + 1,
      streak: nextStreak(me.streak ?? 0, false),
      bestStreak: me.bestStreak ?? 0,
      lastPlayedAt: new Date().toISOString(),
      ...weekPatch(me, deltaA),
      ...seasonPatch(season, rating + deltaA),
      // S4-07: 3 abandonos en 24 h → 5 min sin buscar partida.
      ...(() => {
        const a = recordAbandon(me.abandons);
        if (a.banUntil) console.log(`[antiabuso] ${playerId.slice(0, 8)} ${a.abandons.length} abandonos en 24 h → sin cola hasta ${a.banUntil}`);
        return a.banUntil ? { abandons: a.abandons, queueBanUntil: a.banUntil } : { abandons: a.abandons };
      })(),
    });
    console.log(`[elo] abandono code=${room.code} ${playerId.slice(0, 8)} ${rating} → ${rating + deltaA} (derrota por abandono)`);
    // S4-01: al historial.
    await recordResult({
      playerId,
      won: false,
      abandoned: true,
      ratingBefore: rating,
      ratingAfter: rating + deltaA,
      roomCode: room.code,
      ...table,
    });
  } catch (err) {
    console.log(`[elo] error actualizando ${playerId}: ${(err as Error).message}`);
  }
}

/**
 * Hook S2-17: actualiza ELO de los humanos al final de una partida
 * (cuando `state.matchEnded` pasa de false a true).
 *
 * Decisiones:
 *  - **Solo con ≥2 humanos** (partidas con bots no cuentan para ELO,
 *    según plan original). Si todos los seats son bots, no-op.
 *  - **Rating medio del equipo**: cada equipo tiene un rating (medio
 *    de sus humanos), y `applyEloTeam` calcula el delta sobre ese
 *    rating. Cada humano del equipo recibe el mismo delta.
 *  - **Fire-and-forget**: la respuesta al cliente no espera a Cosmos.
 *    Si Cosmos falla, log pero no afecta a la partida.
 *  - **No persistimos el documento `match` aquí** (queda para S2-17
 *    pieza 4 si el usuario quiere histórico); solo actualizamos los
 *    ratings de los 4 humanos.
 */
// ───────────── S5-04: fin de partida para otros módulos ─────────────

export interface PartidaEnd {
  code: string;
  isPrivate: boolean;
  /** playerIds de los humanos (no bots ni sustitutos) de cada equipo. */
  teams: Record<0 | 1, string[]>;
  winner: 0 | 1;
}
type PartidaEndListener = (e: PartidaEnd) => Promise<unknown>;
const partidaEndListeners: PartidaEndListener[] = [];

/** Registra quien quiera enterarse de cada partida terminada (p. ej. los retos). */
export function onPartidaEnd(fn: PartidaEndListener): void {
  partidaEndListeners.push(fn);
}

function notifyPartidaEnd(room: Room, winner: 0 | 1): void {
  if (partidaEndListeners.length === 0) return;
  const teams: Record<0 | 1, string[]> = { 0: [], 1: [] };
  for (const p of room.players) {
    if (p.token === null || p.substitute || !p.playerId) continue;
    teams[(p.seat % 2) as 0 | 1].push(p.playerId);
  }
  const e: PartidaEnd = { code: room.code, isPrivate: room.isPrivate, teams, winner };
  for (const fn of partidaEndListeners) {
    fn(e).catch((err) => console.log(`[partida] listener falló: ${(err as Error).message}`));
  }
}

export async function updateEloOnHandEnd(room: Room, winner: 0 | 1): Promise<void> {
  if (room.isPrivate) {
    console.log(`[elo] skip code=${room.code}: mesa privada (no cuenta para ELO)`);
    return;
  }
  const cosmos = getCosmosHandles();
  if (!cosmos) {
    console.log(`[elo] skip code=${room.code}: sin Cosmos (PERSISTENCE_BACKEND=memory)`);
    return;
  }
  const seatsInfo = room.players
    .map((p) => `s${p.seat}:${p.token === null ? 'bot' : p.playerId ? p.playerId.slice(0, 8) : 'humano-sin-pid'}`)
    .join(' ');
  console.log(`[elo] fin de partida code=${room.code} winner=team${winner} seats=[${seatsInfo}]`);

  type HumanRating = {
    playerId: string;
    hasAccount: boolean;
    seat: number;
    rating: number;
    games: number;
    wins: number;
    losses: number;
    streak: number;
    bestStreak: number;
    week: { weekId?: string | undefined; weekPoints?: number | undefined; weekGames?: number | undefined };
    pairMember: PairMember;
    season: { rating: number; peak: number; badges: SeasonBadge[] };
  };
  const humans: Record<0 | 1, HumanRating[]> = { 0: [], 1: [] };

  for (const slot of room.players) {
    if (slot.token === null) continue; // bot
    if (!slot.playerId) {
      console.log(`[elo] seat ${slot.seat} es humano pero no tiene playerId (¿sin cookie guinote_pid?)`);
      continue;
    }
    // Seats 0,2 → equipo 0; seats 1,3 → equipo 1
    const team: 0 | 1 = (slot.seat % 2 === 0 ? 0 : 1) as 0 | 1;
    try {
      const { resource } = await cosmos.players.item(slot.playerId, slot.playerId).read();
      if (!resource) {
        console.log(`[elo] player ${slot.playerId} no existe en Cosmos`);
        continue;
      }
      const r = resource as {
        rating?: number;
        games?: number;
        wins?: number;
        losses?: number;
        streak?: number;
        bestStreak?: number;
        userId?: string;
        weekId?: string;
        weekPoints?: number;
        weekGames?: number;
        publicName?: string;
        tag?: string;
        place?: { province: string; municipio: string | null } | null;
        seasonId?: string;
        seasonPeak?: number;
        seasonBadges?: SeasonBadge[];
      };
      const season = seasonStart(r); // S4-09: cambio de temporada si toca
      humans[team].push({
        playerId: slot.playerId,
        hasAccount: !!r.userId,
        seat: slot.seat,
        rating: season.rating,
        season,
        games: r.games ?? 0,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        streak: r.streak ?? 0,
        bestStreak: r.bestStreak ?? 0,
        week: { weekId: r.weekId, weekPoints: r.weekPoints, weekGames: r.weekGames },
        // S4-05: para el ranking de parejas.
        pairMember: {
          playerId: slot.playerId,
          name: r.publicName ?? slot.name,
          tag: r.tag ?? '0000',
          province: r.place?.province ?? null,
          municipio: r.place?.municipio ?? null,
        },
      });
    } catch (err) {
      console.log(`[elo] error leyendo player ${slot.playerId}: ${(err as Error).message}`);
    }
  }

  // Si algún equipo no tiene humanos, no se juega ELO (partida con bots).
  if (humans[0].length === 0 || humans[1].length === 0) {
    console.log(`[elo] skip code=${room.code}: hace falta al menos un humano con playerId en CADA equipo (team0=${humans[0].length}, team1=${humans[1].length})`);
    return;
  }

  const meanRating = (xs: HumanRating[]) => xs.reduce((a, b) => a + b.rating, 0) / xs.length;
  const meanGames = (xs: HumanRating[]) => Math.round(xs.reduce((a, b) => a + b.games, 0) / xs.length);
  const winnerTeam: 0 | 1 = winner;
  const loserTeam: 0 | 1 = (1 - winner) as 0 | 1;
  const ratingA = meanRating(humans[winnerTeam]);
  const ratingB = meanRating(humans[loserTeam]);
  const gamesA = meanGames(humans[winnerTeam]);
  const gamesB = meanGames(humans[loserTeam]);

  const elo = applyEloTeam(ratingA, ratingB, 1, gamesA, gamesB);

  // S4-08: ¿dos rivales desde la misma conexión? Se marca para revisar
  // (puede ser una familia en casa); no se castiga.
  const nets = (team: 0 | 1) => new Set(humans[team].map((h) => room.players[h.seat]?.net).filter((n): n is string => !!n));
  const n0 = nets(0);
  const sameNet = [...nets(1)].some((n) => n0.has(n));
  if (sameNet) console.log(`[antiabuso] code=${room.code} rivales desde la misma conexión (posible multicuenta, para revisar)`);

  const apply = async (hs: HumanRating[], delta: number, won: boolean): Promise<void> => {
    for (const h of hs) {
      try {
        const streak = nextStreak(h.streak, won);
        await updatePlayerRating(cosmos, h.playerId, {
          rating: h.rating + delta,
          games: h.games + 1,
          // Acumulamos (antes se sobrescribía con 1/0).
          wins: h.wins + (won ? 1 : 0),
          losses: h.losses + (won ? 0 : 1),
          streak,
          bestStreak: Math.max(h.bestStreak, streak),
          lastPlayedAt: new Date().toISOString(),
          ...weekPatch(h.week, delta),
          ...seasonPatch(h.season, h.rating + delta),
        });
        console.log(`[elo] ${h.playerId.slice(0, 8)} ${h.rating} → ${h.rating + delta} (${won ? 'gana' : 'pierde'})`);
        // S4-02: división nueva (solo con cuenta); aviso si cambia.
        if (h.hasAccount) {
          const before = divisionFor(h.rating, h.games);
          const after = divisionFor(h.rating + delta, h.games + 1);
          const slot = room.players[h.seat];
          if (slot && slot.playerId === h.playerId) {
            if (after) slot.division = after;
            if (after && after !== before) {
              const msg: ServerMessage = { type: 'DIVISION_CHANGED', from: before, to: after };
              if (slot.ws && slot.ws.readyState === 1) slot.ws.send(JSON.stringify(msg));
            }
          }
        }
        // S4-01: al historial.
        await recordResult({
          playerId: h.playerId,
          won,
          ratingBefore: h.rating,
          ratingAfter: h.rating + delta,
          roomCode: room.code,
          ...describeTable(room, h.seat),
          ...(sameNet ? { flag: 'misma_conexion' as const } : {}),
        });
      } catch (err) {
        // Si falla un player, seguimos con los demás (no rompemos la partida).
        console.log(`[elo] error actualizando ${h.playerId}: ${(err as Error).message}`);
      }
    }
  };

  await apply(humans[winnerTeam], elo.deltaA, true);
  await apply(humans[loserTeam], elo.deltaB, false);
  broadcastSeats(room); // S4-02: divisiones al día

  // S4-05: nivel de las parejas fijas (dos con cuenta y el mismo partyCode).
  const side = (team: 0 | 1): PairSide => {
    const hs = humans[team];
    const a = hs[0];
    const b = hs[1];
    const code = a ? room.players[a.seat]?.partyCode : undefined;
    const isPair = hs.length === 2 && !!code && room.players[b!.seat]?.partyCode === code && a!.hasAccount && b!.hasAccount;
    return { pair: isPair ? [a!.pairMember, b!.pairMember] : null, meanRating: meanRating(hs) };
  };
  try {
    const updated = await updatePairs(pairRepo(), { 0: side(0), 1: side(1) }, winner);
    for (const p of updated) console.log(`[parejas] ${p.members[0].name} & ${p.members[1].name} → ${p.rating}`);
  } catch (err) {
    console.log(`[parejas] no se pudo actualizar: ${(err as Error).message}`);
  }
}
