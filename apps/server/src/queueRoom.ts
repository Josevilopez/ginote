/**
 * S3-05: de una mesa formada por la cola (`matchmaking.ts`) a una sala.
 *
 * Crea la sala, reserva un asiento por jugador (con su token), fija el
 * nivel de los bots y deja que `scheduleLobbyCheck` reparta en cuanto
 * conecten todos (o a los 10 s como mucho). Luego avisa a cada entrada
 * de su mesa y sus tokens.
 */
import { createRoomWithBots } from './rooms.js';
import { reserveSeat, scheduleLobbyCheck, type Room } from './room.js';
import type { FormedTable } from './matchmaking.js';

/** Margen para que los jugadores conecten antes de repartir. */
export const QUEUE_START_GRACE_MS = 10_000;

export function startQueuedTable(table: FormedTable, now: number = Date.now()): Room {
  const room = createRoomWithBots({ fillWithBots: false });
  room.botLevel = table.botLevel;
  room.autoStart = { deadline: now + QUEUE_START_GRACE_MS };
  const notices: (() => void)[] = [];
  table.entries.forEach((entry, i) => {
    const seats = table.seats[i]!;
    const tokens = entry.members.map((m, k) =>
      reserveSeat(room, seats[k]!, {
        name: m.name,
        playerId: m.playerId,
        ...(entry.partyCode ? { partyCode: entry.partyCode } : {}),
      }),
    );
    notices.push(() => entry.notify({ roomCode: room.code, seats, tokens }));
  });
  scheduleLobbyCheck(room);
  for (const n of notices) {
    try {
      n();
    } catch {
      // El aviso a un cliente no debe tumbar la mesa de los demás.
    }
  }
  console.log(
    `[cola] mesa ${room.code}: ${table.entries
      .map((e, i) => e.members.map((m, k) => `${m.name}(${Math.round(m.rating)})@${table.seats[i]![k]}`).join('+'))
      .join(', ')} · bots=${table.bots} nivel=${table.botLevel}`,
  );
  return room;
}
