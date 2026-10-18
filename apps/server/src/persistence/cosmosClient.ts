import { CosmosClient, type Database, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Inicializa el cliente de Cosmos y asegura que la base de datos y los
 * tres contenedores (`players`, `matches`, `snapshots`) existen.
 *
 * Autenticación (decidida el 2026-10-18):
 *  - **Managed Identity** vía `DefaultAzureCredential` (orden de prueba:
 *    `EnvironmentCredential`, `WorkloadIdentityCredential`,
 *    `ManagedIdentityCredential`, `AzureCliCredential`).
 *    En ACA usa la system-assigned identity del container. En local usa
 *    la sesión de `az login` (`AzureCliCredential`).
 *  - Si `COSMOS_KEY` está presente en el entorno, se usa como fallback
 *    explícito (útil para CI sin `az login` o para tests rápidos).
 *
 * Idempotente: se puede llamar varias veces al arrancar (útil si el
 * server rehidrata varias veces). Los contenedores se crean con
 * `createIfNotExists` para no fallar cuando ya están.
 *
 * El contenedor `snapshots` lleva TTL por defecto de 24h sobre el campo
 * `ttl` de cada documento. Esto cumple el compromiso de "una partida
 * abandonada se rehidrata como mucho 24h después".
 *
 * Lanza si falta `COSMOS_ENDPOINT`. El caller decide si cae el server
 * o usa memoria como fallback.
 */
export interface CosmosHandles {
  client: CosmosClient;
  database: Database;
  players: Container;
  matches: Container;
  snapshots: Container;
}

export interface CosmosConfig {
  endpoint: string;
  /** Si está presente, se usa key. Si no, DefaultAzureCredential. */
  key: string | undefined;
  database: string;
}

export function readCosmosConfig(env: NodeJS.ProcessEnv = process.env): CosmosConfig {
  const endpoint = env.COSMOS_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      'COSMOS_ENDPOINT es obligatorio cuando PERSISTENCE_BACKEND=cosmos',
    );
  }
  return {
    endpoint,
    key: env.COSMOS_KEY || undefined,
    database: env.COSMOS_DATABASE ?? 'ginote',
  };
}

/**
 * Crea la base de datos y los tres contenedores si no existen.
 * Pensado para invocarse UNA vez al arrancar.
 */
export async function initCosmos(config: CosmosConfig): Promise<CosmosHandles> {
  // Dos rutas de autenticación según haya key explícita o no:
  //  - con key: SDK usa la auth clásica por primary key (más simple).
  //  - sin key: SDK delega en DefaultAzureCredential, que en ACA toma
  //    la system-assigned identity y en local la sesión de `az login`.
  const client = config.key
    ? new CosmosClient({ endpoint: config.endpoint, key: config.key })
    : new CosmosClient({
        endpoint: config.endpoint,
        aadCredentials: new DefaultAzureCredential(),
      });

  const { database } = await client.databases.createIfNotExists({ id: config.database });
  const players = (
    await database.containers.createIfNotExists({ id: 'players', partitionKey: '/id' })
  ).container;
  const matches = (
    await database.containers.createIfNotExists({ id: 'matches', partitionKey: '/id' })
  ).container;
  // `snapshots` lleva defaultTtl = 86_400 s (24 h) sobre el campo `ttl`
  // de cada documento. Si el server no reescribe el snapshot, Cosmos
  // lo borra automáticamente. Esto evita que mesas abandonadas vivan
  // para siempre y consuman RU.
  const snapshots = (
    await database.containers.createIfNotExists({
      id: 'snapshots',
      partitionKey: '/tableId',
      defaultTtl: 86_400,
    })
  ).container;
  return { client, database, players, matches, snapshots };
}