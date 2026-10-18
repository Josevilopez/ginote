import { createRoom, type Room } from '../room.js';
import type { CreateRoomOpts, RoomStore } from './types.js';

/**
 * Implementación en memoria de `RoomStore`. Mantiene las salas en un
 * `Map<code, Room>` privado al proceso.
 *
 * Es la implementación por defecto y la que usa el server en desarrollo.
 * Las salas se pierden cuando el proceso muere (ver `SPRINT2.md` S2-14
 * para la migración).
 */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();

  create(opts: CreateRoomOpts): Room {
    if (this.rooms.has(opts.code)) {
      throw new Error(`Sala ${opts.code} ya existe`);
    }
    const room = createRoom({ code: opts.code, fillWithBots: opts.fillWithBots });
    this.rooms.set(opts.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  list(): Room[] {
    return Array.from(this.rooms.values());
  }
}