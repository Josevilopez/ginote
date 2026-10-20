import { newRoomCode } from './roomCodes.js';
import type { Room } from './room.js';
import { MemoryRoomStore } from './persistence/memory.js';
import type { RoomStore } from './persistence/types.js';

/**
 * Singleton de `RoomStore`. Por defecto usa `MemoryRoomStore` (todo en
 * RAM). Sprint 2-14 fase 2 lo sustituirá por `CosmosRoomStore` cuando
 * haya credenciales de Azure, controlado por env var.
 */
let store: RoomStore = new MemoryRoomStore();

/** Inyecta un backend distinto. Pensado para tests y para la fase 2. */
export function setRoomStore(s: RoomStore): void {
  store = s;
}

/** Acceso al backend activo. Útil para debug o para `CosmosRoomStore`. */
export function getRoomStore(): RoomStore {
  return store;
}

export function createRoomWithBots(opts: { fillWithBots?: boolean } = {}): Room {
  const code = newRoomCode(4);
  return store.create({ code, fillWithBots: opts.fillWithBots ?? false });
}

export function getRoom(code: string): Room | undefined {
  return store.get(code);
}

export function listRooms(): Room[] {
  return store.list();
}
