/**
 * Handle global al cliente de Cosmos. Lo escribe `initPersistence()` en
 * `index.ts` al arrancar (cuando `PERSISTENCE_BACKEND=cosmos`) y lo
 * lee cualquier módulo que lo requiera (sea `room.ts` para el hook de
 * ELO, sea `players.ts` para CRUD).
 *
 * Existe como módulo aparte para evitar import circular entre
 * `index.ts` y `room.ts`.
 */
import type { CosmosHandles } from './persistence/cosmosClient.js';

let cosmosHandles: CosmosHandles | null = null;

export function setCosmosHandles(h: CosmosHandles | null): void {
  cosmosHandles = h;
}

export function getCosmosHandles(): CosmosHandles | null {
  return cosmosHandles;
}