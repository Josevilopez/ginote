import { createRoom, type Room } from '../room.js';
import type { CreateRoomOpts, RoomStore } from './types.js';
import type { CosmosHandles } from './cosmosClient.js';

/**
 * Implementación de `RoomStore` para Azure Cosmos DB.
 *
 * Las salas activas viven en RAM (mapa interno), igual que
 * `MemoryRoomStore`. Cosmos entra solo como **almacén de snapshots**
 * para sobrevivir SIGTERM y reinicios del contenedor.
 *
 * Operaciones cubiertas por la interface `RoomStore`:
 * - `create`: igual que `MemoryRoomStore` — solo RAM.
 * - `get` / `list`: leen del mapa interno.
 *
 * Operaciones específicas de Cosmos (no en la interface `RoomStore`):
 * - `saveSnapshot(...)`: persiste el estado actual de la sala con TTL
 *   de 24 h, para rehidratar tras reinicio.
 * - `loadActiveSnapshots()`: lee los snapshots no caducados y los
 *   reinyecta como `Room` activas, marcando los humanos como
 *   `human_disconnected`.
 * - `saveMatch(...)` y `savePlayer(...)`: para S2-13 (revancha → fin
 *   de partida → match) y S2-17 (ELO).
 *
 * Las salas en RAM **no** se persisten por acción: solo al final de
 * cada mano, fin de partida, y SIGTERM. Esto mantiene el consumo de
 * RU bajo (ver SPRINT2.md S2-14, riesgo #1).
 */
export class CosmosRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly cosmos: CosmosHandles;

  constructor(cosmos: CosmosHandles) {
    this.cosmos = cosmos;
  }

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

  /**
   * Persiste el estado actual de una sala. Pensado para llamarse al
   * final de cada mano (post-game) y en SIGTERM, NO por acción.
   *
   * El documento del snapshot tiene `ttl: 86_400` (24 h) heredado del
   * `defaultTtl` del contenedor. Si no se reescribe, Cosmos lo borra.
   *
   * El contenido del documento es responsabilidad de S2-14 fase 2
   * completa (aquí dejamos solo la estructura). La forma del estado
   * del motor y de los seats está en `packages/engine/src/state.ts` y
   * `apps/server/src/room.ts`.
   */
  async saveSnapshot(tableId: string, payload: unknown): Promise<void> {
    // `id = tableId`: un único documento por mesa que se sobrescribe. Antes
    // no se pasaba `id` y el SDK generaba uno nuevo en cada upsert, así
    // que se acumulaban documentos por mesa.
    await this.cosmos.snapshots.items.upsert({
      id: tableId,
      tableId,
      payload,
      savedAt: new Date().toISOString(),
    });
  }

  /** S2-14: borra todos los snapshots de una mesa (incluidos los antiguos con id aleatorio). */
  async deleteSnapshot(tableId: string): Promise<void> {
    const { resources } = await this.cosmos.snapshots.items
      .query<{ id: string }>({
        query: 'SELECT s.id FROM snapshots s WHERE s.tableId = @t',
        parameters: [{ name: '@t', value: tableId }],
      })
      .fetchAll();
    for (const r of resources) {
      await this.cosmos.snapshots.item(r.id, tableId).delete();
    }
  }

  /** S2-14: borra un documento concreto de `snapshots` (limpieza al rehidratar). */
  async deleteSnapshotDoc(id: string, tableId: string): Promise<void> {
    await this.cosmos.snapshots.item(id, tableId).delete();
  }

  /** S2-14: mete en memoria una sala rehidratada desde su snapshot. */
  adopt(room: Room): void {
    this.rooms.set(room.code, room);
  }

  async loadActiveSnapshots<T = unknown>(): Promise<Array<{ id: string; tableId: string; payload: T }>> {
    const { resources } = await this.cosmos.snapshots.items
      .query({
        query: 'SELECT s.id, s.tableId, s.payload FROM snapshots s WHERE s.savedAt > @since',
        parameters: [{ name: '@since', value: new Date(Date.now() - 86_400_000).toISOString() }],
      })
      .fetchAll();
    return resources as Array<{ id: string; tableId: string; payload: T }>;
  }
}