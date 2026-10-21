import { CosmosClient, type Database, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Inicializa el cliente de Cosmos y abre referencias a los contenedores.
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
 * NO crea los contenedores (decidido el 2026-10-18). El data plane RBAC
 * de Cosmos con "Built-in Data Contributor" no permite `POST /colls`
 * ni siquiera con scope raíz — la creación de contenedores es control
 * plane y hay que hacerla una vez por entorno desde el portal (o con
 * `az cosmosdb sql container create`). Los contenedores necesarios son:
 *   - `players` (PK `/id`)
 *   - `matches` (PK `/id`)
 *   - `snapshots` (PK `/tableId`, defaultTtl = 86_400 s = 24 h)
 *
 * Si los contenedores faltan, las escrituras fallarán con 404 "Resource
 * not found" y el caller lo verá claro.
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
  /** S3-01: cuentas (PK `/userId`). Hay que crearlo en el portal. */
  users: Container;
  /** S4-01: historial de partidas (PK `/playerId`). Hay que crearlo en el portal. */
  results: Container;
  /** S4-05: parejas fijas con su nivel (PK `/id`). Hay que crearlo en el portal. */
  pairs: Container;
  /** S5-02: suscripciones de avisos push (PK `/userId`). Hay que crearlo en el portal. */
  pushSubs: Container;
  /** S5-03: peñas (PK `/id`). Hay que crearlo en el portal. */
  penas: Container;
  /** S5-04: retos entre peñas (PK `/id`). Hay que crearlo en el portal. */
  retos: Container;
  /** S5-05: torneos (PK `/id`). Hay que crearlo en el portal. */
  torneos: Container;
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
 * Abre el cliente y los handles. NO crea la base de datos ni los
 * contenedores (ver comentario de la cabecera).
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

  // La base de datos `ginote` debe existir (creada en el portal).
  const players = client.database(config.database).container('players');
  const matches = client.database(config.database).container('matches');
  const snapshots = client.database(config.database).container('snapshots');
  const users = client.database(config.database).container('users');
  const results = client.database(config.database).container('results');
  const pairs = client.database(config.database).container('pairs');
  const pushSubs = client.database(config.database).container('pushSubs');
  const penas = client.database(config.database).container('penas');
  const retos = client.database(config.database).container('retos');
  const torneos = client.database(config.database).container('torneos');
  // Si quisieras crear la BD por código, sería aquí con
  //   await client.databases.createIfNotExists({ id: config.database })
  // pero eso requiere control plane RBAC, no data plane.
  return { client, database: client.database(config.database), players, matches, snapshots, users, results, pairs, pushSubs, penas, retos, torneos };
}