import { CosmosClient, type Database, type Container } from '@azure/cosmos';

/**
 * Inicializa el cliente de Cosmos y asegura que la base de datos y los
 * tres contenedores (`players`, `matches`, `snapshots`) existen.
 *
 * Idempotente: se puede llamar varias veces al arrancar (útil si el
 * server rehidrata varias veces). Los contenedores se crean con
 * `createIfNotExists` para no fallar cuando ya están.
 *
 ** Contenedor `snapshots` lleva TTL por defecto de 24h sobre el campo
 * `ttl` de cada documento. Esto cumple el compromiso de "una partida
 * abandonada se rehidrata como mucho 24h después".
 *
 * Lanza si falta `COSMOS_ENDPOINT`, `COSMOS_KEY` o `COSMOS_DATABASE`
 * en el entorno. El caller (S2-14) decide si cae el server o usa
 * memoria como fallback.
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
  key: string;
  database: string;
}

export function readCosmosConfig(env: NodeJS.ProcessEnv = process.env): CosmosConfig {
  const endpoint = env.COSMOS_ENDPOINT;
  const key = env.COSMOS_KEY;
  const database = env.COSMOS_DATABASE ?? 'guinote-cosmos-dev';
  if (!endpoint || !key) {
    throw new Error(
      'COSMOS_ENDPOINT y COSMOS_KEY son obligatorios cuando PERSISTENCE_BACKEND=cosmos',
    );
  }
  return { endpoint, key, database };
}

/**
 * Crea la base de datos y los tres contenedores si no existen.
 * Pensado para invocarse UNA vez al arrancar.
 */
export async function initCosmos(config: CosmosConfig): Promise<CosmosHandles> {
  const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
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