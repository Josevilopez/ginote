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
import { stepHeuristicBot } from '@guinote/bots';

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
  state: GameState;
  /** Set de commandIds ya procesados (idempotencia básica). */
  seenCommandIds: Set<string>;
  /** Eventos pendientes para el log. */
  log: GameEvent[];

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

  const state = newHand({
    id: `g-${opts.code}`,
    seed: cryptoToken(),
    rules: GUINOTE_ARAGONES,
    // Sorteo inicial: el dealer de la primera mano se elige al azar entre
    // los 4 asientos. A partir de ahí se aplica la regla del guiñote
    // aragonés: "el que corta, reparte" (winner of last trick → next dealer),
    // y siempre tira el de la derecha del dealer. Implementado en
    // `startNextHand` + `nextDealer` del motor.
    dealer: Math.floor(Math.random() * 4) as Seat,
  });

  return {
    code: opts.code,
    players,
    state,
    seenCommandIds: new Set(),
    log: [],
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
    }
  }
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
    if (room.state.phase === 'finished') return acted;
    const turn = room.state.turn;
    if (turn === null) return acted;
    const player = room.players[turn]!;
    if (player.token !== null) return acted;
    const before = room.state.finishedTricks.length;
    if (!stepHeuristicBot(room.state, turn)) return acted;
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
  if (room.matchFinished) return;
  if (room.state.phase !== 'finished') return;

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
}

function broadcastGameOver(room: Room): void {
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
  if (room.state.matchEnded && room.state.matchWinner !== null) {
    broadcast(room, {
      type: 'MATCH_OVER' as any,
      winner: room.state.matchWinner,
      score: room.state.score,
      vuelta: room.state.vuelta,
    } as any);
  }
}
