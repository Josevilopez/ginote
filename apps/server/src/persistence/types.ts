import type { Room } from '../room.js';

/**
 * Opciones para crear una sala nueva.
 *
 * `code` lo genera el caller (ver `newRoomCode` en `roomCodes.ts`); el
 * backend no lo autogenera porque algunas implementaciones (Cosmos,
 * snapshots) pueden querer prefijarlo o rechazarlo si ya existe.
 *
 * `fillWithBots` controla si la sala arranca ya completa con bots
 * (modo "Jugar con bots") o si espera a que entren humanos en lobby
 * (modo "Jugar con jugadores" / matchmaking).
 */
export interface CreateRoomOpts {
  code: string;
  fillWithBots: boolean;
}

/**
 * Almacén de salas. Abstrae dónde y cómo viven los objetos `Room`.
 *
 * La implementación por defecto vive solo en RAM (`MemoryRoomStore`).
 * Sprint 2-14 añadirá `CosmosRoomStore` con snapshots y rehidratación.
 *
 * Decisiones de diseño:
 * - **Sin `delete` aún**. Las salas hoy mueren cuando el server reinicia;
 *   Cosmos traerá TTL de 24h sobre snapshots, no sobre salas activas.
 * - **Sin transacciones**. El motor del juego (`apply`) es puro y
 *   determinista; el server serializa acciones por sala en una cola.
 *   Esto evita race conditions entre lecturas y escrituras.
 * - **`create` puede lanzar** si el `code` ya existe. Cosmos hará lo
 *   mismo (PK duplicada → excepción). El caller decide si reintenta con
 *   otro código.
 */
export interface RoomStore {
  /** Crea una sala y la persiste. Lanza si `code` ya existe. */
  create(opts: CreateRoomOpts): Room;

  /** Busca una sala por código. Devuelve `undefined` si no existe. */
  get(code: string): Room | undefined;

  /** Lista todas las salas vivas (en RAM o rehidratadas). */
  list(): Room[];
}