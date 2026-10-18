import type { Room } from './room.js';

/**
 * S2-14: punto de enganche entre la lógica de sala (`room.ts`) y la
 * persistencia (Cosmos). `room.ts` llama a `persistRoom` / `forgetRoom`
 * en los momentos clave; `index.ts` registra el "sink" real al arrancar
 * con `PERSISTENCE_BACKEND=cosmos`. Con backend `memory` no hay sink y
 * las llamadas son no-op. Así `room.ts` no importa nada de Cosmos (y no
 * hay ciclos de imports).
 */
export interface SnapshotSink {
  save(room: Room): Promise<void>;
  remove(code: string): Promise<void>;
}

let sink: SnapshotSink | null = null;

export function setSnapshotSink(s: SnapshotSink | null): void {
  sink = s;
}

/** Guarda (fire-and-forget) el snapshot de la sala. Nunca rompe la partida. */
export function persistRoom(room: Room, reason: string): void {
  if (!sink) return;
  sink
    .save(room)
    .then(() => console.log(`[snapshot] code=${room.code} guardado (${reason})`))
    .catch((err: unknown) => console.log(`[snapshot] code=${room.code} error guardando (${reason}): ${(err as Error).message}`));
}

/** Borra (fire-and-forget) el snapshot de la sala: match cerrado, nada que rehidratar. */
export function forgetRoom(code: string): void {
  if (!sink) return;
  sink
    .remove(code)
    .then(() => console.log(`[snapshot] code=${code} borrado`))
    .catch((err: unknown) => console.log(`[snapshot] code=${code} error borrando: ${(err as Error).message}`));
}
