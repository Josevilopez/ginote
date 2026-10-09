import { createRoom, type Room } from './room.js';
import { newRoomCode } from './roomCodes.js';

const rooms = new Map<string, Room>();

export function createRoomWithBots(): Room {
  const code = newRoomCode(4);
  const room = createRoom({ code, fillWithBots: true });
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function listRooms(): Room[] {
  return Array.from(rooms.values());
}
