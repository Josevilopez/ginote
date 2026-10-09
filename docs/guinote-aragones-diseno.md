# Guiñote aragonés online: diseño y reglas

Estado a fecha de hoy: planteamiento técnico, reglas definidas, infraestructura Azure con Cosmos DB y borrador de `RulesConfig` / `legalPlays`.

---

## 1. Reglas definidas (confirmadas por ti)

### Baraja y puntos
- Baraja española de 40 cartas.
- Puntos: **As 11, Tres 10, Rey 4, Sota 3, Caballo 2**, resto 0.
- **10 puntos de últimas** (última baza).
- Fuerza de las cartas: **As > 3 > Rey > Sota > Caballo > 7 > 6 > 5 > 4 > 2**.
  - *Nota:* tu mensaje repetía mi pregunta sin marcarla; la he dado por buena. Confírmala.

### Jugadores y mesa
- 4 jugadores en parejas, 6 cartas cada uno.
- Sentido de juego **antihorario**.
- Asientos numerados en orden de juego: el siguiente asiento `+1` es siempre "el de la derecha".

### Reparto y salida
- Se reparte **de 3 en 3**.
- El repartidor rota a la derecha (`dealer + 1`).
- Sale primero el que está a la derecha del que reparte (`dealer + 1`).
- El triunfo lo marca la siguiente carta tras repartir; es **visible en todo momento** y se la lleva el último en robar.

### Fase de robo
- Se juega sin obligación de asistir.
- El ganador de la baza roba primero y luego se sigue en sentido antihorario.
- El **arrastre empieza justo al robarse la última carta**. La ultima carta es la visible y la que marca el triunfo.

### Fase de arrastre
- Obligación de **servir**, **superar** y **fallar con triunfo**.
- Si el palo de salida es triunfo, hay que superar con un triunfo mayor.
- Si el compañero ya va ganando la baza, **no estás obligado a superar**.
- Si no tienes el palo ni triunfo, puedes tirar cualquier carta.
- Si el compañero va ganando, libra de superar.
- Sin el palo de salida, con triunfo en mesa más alto que el tuyo y sin poder superarlo: no obligado a tirar triunfo
- Se puede cantar durante el arrastre

### Cambio del 7
- Solo en tu turno, solo si ganaste la última baza y solo en fase de robo.
- El 7 de triunfo se cambia por la carta de triunfo visible.

### Cantes
- Sota y Rey del mismo palo: **20 puntos**; en el palo de triunfo, **40**.
- Canta el ganador de la baza y también su compañero.
- Hay que cantar en voz alta.
- Cuándo se canta: asumo la ventana tras ganar la baza y antes de tirar carta

### Varios
**Puntuación de la partida**: puntos para ganar una mano (101, 50 malas + 50 buenas, al superar la 50 buenas ganas), si de idas (primera partida) ninguna de las dos parejas llega a 51 buenas, se hace la partida de vueltas,  malas/buenas (puntos de cada tramo, mitad de partida). Una vez estamos en la partida de vueltas, los puntos se añaden a la partida de idas, y cuando una pareja llega a las 51 buenas, gana y se termina la partida de forma anticipada. La partida de idas siempre llega al final, al final de la misma se hace el recuento.
- **Señas**: de momento no se permiten señas.
- **Cambio del 7**: si un jugador tiene el 7 de triunfo, lo por la carta visible, lo puede cambiar cuando gana una jugada, el o su compañero, y antes de que se empiece a tirar.
- **Renuncio**: online lo bloquea `legalActions`; 
- **Memoria** (consultar bazas jugadas),
- **Producto**: modos (rápida, ranking de puntuaciones), tiempo por turno, baraja  libre de licencia, idiomas (españoñ)
---


## 3. Planteamiento técnico

Idea central: **servidor autoritativo + motor de reglas puro y determinista, compartido entre back y front**.

### Monorepo (pnpm + Turborepo, TypeScript)

```
packages/
  engine/    # reglas puras, sin I/O, sin Date.now(), sin Math.random()
  protocol/  # tipos de comandos/eventos + esquemas zod
  bots/      # IA para rellenar asientos
apps/
  server/    # Fastify + WebSocket, rooms, auth, persistencia
  web/       # React + Vite
infra/       # Bicep o Terraform
```

### Motor de juego
Reducer puro y determinista:

```ts
function legalActions(state: GameState, seat: Seat): Action[];
function apply(state: GameState, action: Action): { state: GameState; events: GameEvent[] };
function viewFor(state: GameState, seat: Seat): PlayerView;   // oculta manos ajenas
```

- **Reproducibilidad**: `seed + log de acciones` reconstruye cualquier partida (reconexión, replays, depuración).
- **`legalActions` como fuente de verdad**: el servidor valida con ella y el cliente resalta cartas jugables.
- **`viewFor`**: el servidor nunca envía manos ajenas ni el mazo.
- Testeable sin red ni UI.

### Backend en tiempo real
- Fastify + `ws` (o Socket.IO). Para un juego por turnos, modelo propio.
- **Room actor**: cada mesa es un objeto en memoria con cola de comandos serializada; valida con el motor, aplica, persiste y emite a cada jugador su vista.
- Protocolo con `commandId` idempotente y `version` incremental; si el cliente detecta un hueco, pide snapshot.
- **Temporizadores**: guardar deadlines en el estado, no `setTimeout` como fuente de verdad.
- **Desconexiones**: periodo de gracia, reconexión por token y relevo por bot.
- **Bots**: heurísticos primero, ISMCTS después.

### Frontend (React)
- Vite + TypeScript, Zustand (o XState).
- Cliente "tonto": renderiza `PlayerView` y envía comandos, sin lógica optimista.
- **Cola de animaciones dirigida por eventos** (Framer Motion).
- Cartas en SVG, mobile-first y PWA, i18n es/en.
- Chat y señas con vocabulario cerrado.

### Testing
- Tests unitarios del motor con manos conocidas.
- Property-based testing (fast-check).
- Simulación masiva de partidas bot vs bot en CI.
- E2E con Playwright (4 contextos) y carga con k6/Artillery.

### Roadmap
1. Motor + tests + CLI jugable.
2. Mesa de 4 con bots, UI básica, WebSocket local.
3. Salas privadas por código, reconexión, temporizadores.
4. Despliegue en Azure, auth, persistencia.
5. Matchmaking, ranking, replays, señas, PWA pulida.

### Riesgos a vigilar
- Filtrar información oculta (usar siempre `viewFor`).
- Divergencia de reglas entre zonas (resolver con `RulesConfig`).
- Estado de sala solo en memoria sin persistir.
- Animaciones acopladas al estado en vez de a eventos.

---

## 4. Infraestructura Azure

### MVP

| Componente | Servicio | Notas |
|---|---|---|
| Front React | Static Web Apps | CDN, HTTPS y dominio propio |
| Backend Node + WebSocket | Container Apps (Consumption) | `minReplicas: 1` |
| Imágenes | Container Registry (Basic) | |
| Base de datos | **Cosmos DB (API for NoSQL), serverless o free tier** | Sustituye a PostgreSQL |
| Secretos | Key Vault + Managed Identity | Solo secretos propios (p. ej. clave JWT) |
| Observabilidad | Log Analytics + Application Insights | |
| CI/CD | GitHub Actions con OIDC | Sin secretos de larga duración |

Puntos importantes:
- **`minReplicas: 1`**: si escala a cero se pierden las mesas en memoria.
- **Heartbeat** cada 20-30 s en el WebSocket (el ingress corta conexiones inactivas en torno a 4 minutos).
- **Despliegues**: al recibir `SIGTERM`, persistir mesas, avisar a los clientes y reconectar solos.
- Static Web Apps no hace de proxy de WebSockets: el cliente se conecta directamente al dominio de Container Apps.
- Sin Redis en el MVP (una réplica, estado en memoria + persistencia tras cada acción).

### Producción
- Azure Managed Redis (propiedad de mesas, presencia, rate limiting).
- Azure Web PubSub (opcional) para las conexiones.
- Front Door con WAF.
- VNet + private endpoints.
- Auth: Entra External ID o login propio + Google/Apple.
- 2+ réplicas, alertas con Azure Monitor.
- Una mesa vive en un solo nodo: lock de propiedad en Redis (`room:{id}:owner` con TTL renovable).

### Entornos
`rg-guinote-dev` y `rg-guinote-prod`, con IaC en Bicep o Terraform (o `azd` para arrancar rápido).

---

## 5. Cosmos DB: modelo de datos

Un contenedor `games` con partition key `/gameId`:

```jsonc
// snapshot de la mesa
{ "id": "state", "gameId": "g1", "type": "snapshot",
  "version": 42, "seed": "...", "rules": { ... }, "state": { ... } }

// una acción por documento
{ "id": "g1:43", "gameId": "g1", "type": "action",
  "version": 43, "seat": 2, "action": { "type": "PLAY_CARD", ... } }
```

| Contenedor | Partition key | Contenido |
|---|---|---|
| `users` | `/userId` | Perfil, estadísticas |
| `games` | `/gameId` | Snapshot + log de acciones |
| `rooms` | `/roomCode` | Salas privadas y lobby (con TTL) |
| `rankings` | `/season` | Tabla materializada |

- **Transactional batch** para acción + snapshot de forma atómica.
- **ETag** para concurrencia optimista (dos propietarios de una mesa no corrompen el estado).
- Snapshot cada N acciones; TTL en mesas terminadas.
- Autenticación con Managed Identity y RBAC de plano de datos.
- Ranking y agregados: materializar con el **change feed** (o Redis).
- Acceso a datos detrás de una interfaz `GameRepository`.

Limitaciones frente a Postgres: consultas entre particiones costosas, sin joins ni SQL completo para analítica ad hoc, mayor dependencia del proveedor.

Los precios y límites de serverless y free tier cambian: validar en la calculadora de Azure.

---

## 6. Borrador de `RulesConfig`

> **Aviso:** código escrito sin ejecutar ni probar. Es un punto de partida.

```ts
export type Suit = 'oros' | 'copas' | 'espadas' | 'bastos';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12; // 10 sota, 11 caballo, 12 rey

export interface RulesConfig {
  players: 2 | 4;
  handSize: number;
  dealBatch: number;
  cardPoints: Partial<Record<Rank, number>>;
  strength: Rank[];              // de más fuerte a más débil
  lastTrickBonus: number;
  // asientos en orden de juego (antihorario): next = (seat + 1) % players
  dealerRotation: 'next';
  firstLeader: 'afterDealer';
  draw: { winnerDrawsFirst: boolean; lastCardIsTrump: boolean };
  arrastre: {
    mustFollowSuit: boolean;
    mustOverplay: boolean;
    mustTrumpIfVoid: boolean;
    partnerWinningExemptsOverplay: boolean;
    partnerWinningExemptsTrump: boolean;   // flag pendiente (1)
    mustTrumpEvenIfCantBeat: boolean;      // flag pendiente (2)
  };
  swapSeven: { onlyOnOwnTurn: boolean; onlyIfWonLastTrick: boolean; onlyDuringDraw: boolean; aloud: boolean };
  cantes: {
    pair: [Rank, Rank];
    value: number;
    trumpValue: number;
    teamMayDeclare: boolean;
    allowedInArrastre: boolean;            // flag pendiente (3)
    requireTrickWonByTeam: boolean;        // flag pendiente (4)
  };
  scoring: null;                           // pendiente
}

export const GUINOTE_ARAGONES: RulesConfig = {
  players: 4,
  handSize: 6,
  dealBatch: 3,
  cardPoints: { 1: 11, 3: 10, 12: 4, 10: 3, 11: 2 },
  strength: [1, 3, 12, 10, 11, 7, 6, 5, 4, 2],
  lastTrickBonus: 10,
  dealerRotation: 'next',
  firstLeader: 'afterDealer',
  draw: { winnerDrawsFirst: true, lastCardIsTrump: true },
  arrastre: {
    mustFollowSuit: true,
    mustOverplay: true,
    mustTrumpIfVoid: true,
    partnerWinningExemptsOverplay: true,
    partnerWinningExemptsTrump: false,
    mustTrumpEvenIfCantBeat: true,
  },
  swapSeven: { onlyOnOwnTurn: true, onlyIfWonLastTrick: true, onlyDuringDraw: true, aloud: true },
  cantes: {
    pair: [10, 12], value: 20, trumpValue: 40,
    teamMayDeclare: true, allowedInArrastre: true, requireTrickWonByTeam: false,
  },
  scoring: null,
};
```

---

## 7. Máquina de estados de una mano

```
DEAL (3+3, trumpCard visible)
  └▶ LEAD  (sale dealer+1)
        └▶ FOLLOW × (n-1)          ← legalPlays según fase
              └▶ RESOLVE_TRICK     (ganador, puntos de la baza)
                    └▶ WINNER_WINDOW   (acciones del ganador/compañero:
                    │                   SING, SWAP_SEVEN si fase=draw, o PASS)
                    ├─ mazo no vacío ▶ DRAW (ganador primero, luego +1…)
                    │                    └▶ si se roba la última carta → fase = 'arrastre'
                    │                    └▶ LEAD (sale el ganador)
                    └─ manos vacías ▶ END_HAND (+10 últimas) ▶ SCORE
```

Orden determinista en la ventana del ganador: cante, cambio del 7, robo, salida.

---

## 8. Borrador de `legalPlays`

> **Aviso:** boceto sin ejecutar ni probar. `currentWinner` e `isPartner` están sin escribir. Se ha quitado el parámetro `led` de `beats`, que no se usaba.

```ts
const rankIdx = (c: Card, cfg: RulesConfig) => cfg.strength.indexOf(c.rank);

// ¿a gana a b? (b es la carta que va ganando ahora)
function beats(a: Card, b: Card, trump: Suit, cfg: RulesConfig): boolean {
  if (a.suit === b.suit) return rankIdx(a, cfg) < rankIdx(b, cfg);
  return a.suit === trump && b.suit !== trump;
}

export function legalPlays(s: GameState, seat: Seat, cfg: RulesConfig): Card[] {
  const hand = s.hands[seat];
  const trick = s.trick;
  if (s.phase === 'draw' || trick.plays.length === 0) return hand;   // fase de robo: libre

  const led = trick.plays[0].card.suit;
  const winning = currentWinner(trick, s.trump, led, cfg);           // { seat, card }
  const partnerWins = isPartner(winning.seat, seat, cfg.players);
  const a = cfg.arrastre;

  const sameSuit = hand.filter(c => c.suit === led);
  if (sameSuit.length) {
    if (!a.mustOverplay || (partnerWins && a.partnerWinningExemptsOverplay)) return sameSuit;
    const higher = sameSuit.filter(c => beats(c, winning.card, s.trump, cfg));
    return higher.length ? higher : sameSuit;
  }

  const trumps = hand.filter(c => c.suit === s.trump);
  if (trumps.length && a.mustTrumpIfVoid && !(partnerWins && a.partnerWinningExemptsTrump)) {
    const higher = trumps.filter(c => beats(c, winning.card, s.trump, cfg));
    if (higher.length) return higher;
    return a.mustTrumpEvenIfCantBeat ? trumps : hand;
  }
  return hand;                                                       // sin palo ni triunfo: libre
}
```

---

## 9. Qué cubre y qué no

`RulesConfig` y `legalPlays` **no contienen todas las reglas**. Falta:

| Regla | Dónde vive | Estado |
|---|---|---|
| Quién gana la baza (`currentWinner`) | motor | Referenciada, no escrita |
| Reparto, triunfo, orden de salida y de robo | `apply` | Solo en el diagrama |
| Cambio del 7: condiciones y efecto | `legalActions` + `apply` | Solo flags |
| Cantes: validación, ventana, puntos | `legalActions` + `apply` | Solo flags |
| Puntos de la baza y 10 de últimas | `apply` | Solo en el diagrama |
| Fin de mano y puntuación de partida | `scoring` | Pendiente |
| Señas | módulo aparte | Sin diseñar |
| Temporizadores y abandonos | servidor | Sin diseñar |

Organización en tres capas: **config** (parámetros), **motor** (`legalActions`, `apply`, `viewFor`; `legalPlays` es una pieza de `legalActions`) y **tests** (cada regla decidida es un test con una mano concreta).

---

## 10. Próximos pasos

1. Cerrar la puntuación: puntos para ganar una mano, malas/buenas, vueltas.
2. Escribir `GameState`, `Action`, `GameEvent`, `apply`, `viewFor` y `legalActions` completos.
3. Batería de tests: arrastre con compañero ganando, superar con triunfo, cante de triunfo, cambio del 7.
4. Definir `GameRepository` sobre Cosmos (batch transaccional, ETag, reconstrucción desde snapshot + acciones).
5. Hello-world de WebSocket en Container Apps con heartbeat y Static Web Apps conectada.
