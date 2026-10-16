import { createRoom, type Room } from './room.js';
import { newRoomCode } from './roomCodes.js';

const rooms = new Map<string, Room>();

export function createRoomWithBots(opts: { fillWithBots?: boolean } = {}): Room {
  const code = newRoomCode(4);
  const room = createRoom({ code, fillWithBots: opts.fillWithBots ?? false });
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function listRooms(): Room[] {
  return Array.from(rooms.values());
}

/**
 * Matchmaking para "Jugar con jugadores": busca la mejor sala abierta a
 * humanos y la devuelve. Si no hay ninguna con al menos 1 humano y un
 * hueco, crea una nueva en modo lobby.
 *
 * Criterio de "mejor": más humanos conectados primero (más cerca de
 * llenar mesa). Salas con la partida empezada (`state !== null`) o sin
 * humanos se ignoran. Salas que están a punto de expirar el lobby
 * (`lobbyEndsAt - now < 1500 ms`) también, para no entrar a una sala
 * que va a rellenarse con bots en menos de un abrir y cerrar de ojos.
 *
 * Salas creadas con `mode: 'bots'` ya tienen `state !== null` así que
 * no entran en el pool — los bots juegan entre ellos y los humanos que
 * quieran unirse lo harán por invitación directa con código.
 */
export function findOrCreateMatchmakeRoom(): { room: Room; created: boolean } {
  let best: Room | null = null;
  let bestHumans = -1;
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state !== null) continue; // partida empezada, no admitir más humanos
    // Saltar salas cuyo lobby esté a punto de expirar: el siguiente humano
    // que entre entraría justo cuando los bots van a aparecer. Mejor que
    // el matchmaker cree una sala nueva en ese caso.
    if (room.lobbyEndsAt && room.lobbyEndsAt - now < 1500) continue;
    const humans = room.players.filter((p) => p.token !== null).length;
    if (humans >= 4) continue; // lleno de humanos
    // Cualquier sala en lobby con hueco es candidata — incluida la recién
    // creada sin nadie (humans === 0). Si dos clientes llaman a
    // matchmake simultáneamente, ambos van a la misma sala vacía y al
    // conectar por WS rellenan los dos primeros seats. Esto es lo que
    // queremos: "una sala por partida de matchmaking" en lugar de "una
    // sala por matchmake call".
    if (humans > bestHumans) {
      best = room;
      bestHumans = humans;
    }
  }
  if (best !== null) return { room: best, created: false };
  // No hay sala matcheable. Crear una nueva en modo lobby (sin bots;
  // se rellenarán al expirar la ventana si nadie más entra).
  const code = newRoomCode(4);
  const room = createRoom({ code, fillWithBots: false });
  rooms.set(code, room);
  return { room, created: true };
}
