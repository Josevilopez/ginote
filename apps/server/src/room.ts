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
import { stepBot } from '@guinote/bots';
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
  for (let s = 0 as Seat; s < 4; s = (s + 1) as Seat) {
    if (fill) {
      players.push({ seat: s, name: `Bot ${s + 1}`, token: null, ws: null });
    } else {
      players.push({ seat: s, name: '?', token: null, ws: null });
    }
  }

  const state = newHand({
    id: `g-${opts.code}`,
    seed: cryptoToken(),
    rules: GUINOTE_ARAGONES,
    dealer: 3,
  });

  return {
    code: opts.code,
    players,
    state,
    seenCommandIds: new Set(),
    log: [],
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
      p.ws.send(JSON.stringify({ type: 'VIEW', view, version: room.state.version } satisfies ServerMessage));
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
 * `TRICK_JUST_RESOLVED` justo después. Devuelve `true` si la acción era legal.
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
  trickPauseMs = 4000,
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
    if (!stepBot(room.state, turn)) return acted;
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
 * Dispara la siguiente mano: reparte, emite VIEW y, si el primer turno
 * cae en un bot, arranca el ciclo de bots. Llamado desde el handler del
 * mensaje NEXT_HAND. No-op si la partida ya terminó o no estamos en
 * `phase: 'finished'`.
 */
export function triggerNextHand(room: Room): void {
  if (room.state.matchEnded) return;
  if (room.state.phase !== 'finished') return;
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
 */
export function startNextHand(room: Room): void {
  if (room.state.matchEnded) return;
  const lastHandLastTrick = room.state.finishedTricks[room.state.finishedTricks.length - 1];
  const lastTrickWinner = lastHandLastTrick ? lastHandLastTrick.winner : null;
  const newDealer = nextDealer(lastTrickWinner, room.state.dealer);
  const newVuelta = room.state.vuelta + 1;
  room.state = newHand({
    id: `g-${room.code}-v${newVuelta}`,
    seed: cryptoToken(),
    rules: GUINOTE_ARAGONES,
    dealer: newDealer,
    continuation: {
      vuelta: newVuelta,
      score: room.state.score,
      cumulativeTeamPts: room.state.cumulativeTeamPts,
      matchEnded: room.state.matchEnded,
      matchWinner: room.state.matchWinner,
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
