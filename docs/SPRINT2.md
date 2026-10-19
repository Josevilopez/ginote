# Sprint 2 — Partidas rápidas y revancha

**Goal**: de la home a una mesa en ≤ 2 toques, con rivales de nivel parecido, bots para completar, reconexión y revancha en 1 toque. Persistencia real en Cosmos, deploy permanente en Azure Container Apps, ELO anónimo ya activo para preparar matchmaking de Sprint 3.

**Estado a fecha 2026-10-18**: ✅ **sprint cerrado** salvo el despliegue (S2-16), que hace el usuario a mano. S2-11 (matchmaking con rating) pasa a Sprint 3 como S3-05. Siguiente: [`SPRINT3.md`](SPRINT3.md).

---

## Decisiones (confirmadas el 2026-10-17)

| Eje | Decisión | Razón |
|---|---|---|
| Persistencia | **Azure Cosmos DB (free tier)** | Sobrevive a reinicios del contenedor, ya tenemos cuenta Azure; throughput compartido a nivel de base de datos para controlar RU. |
| Deploy | **Azure Container Apps** (min = max = 1) | Dockerfile listo desde Sprint 1. ACA tiene ingress HTTP con WebSocket y secrets. Migración directa desde el cloudflared local que no llegamos a usar. |
| Identidad / ELO | **ELO anónimo con cookie** (sin cuentas todavía) | Suficiente para matchmaking por rating en S3. Sin fricción de signup. Las cuentas reales (OAuth o Entra External ID) entran en Sprint 4. |
| Protocolo | **NO se toca** en este sprint | `commandId` UUID ya da idempotencia. Migrar a `{v:1, t:..., seq, expectSeq}` es breaking change sin urgencia; se aplaza hasta que haya un segundo cliente (app nativa) que lo justifique. |

---

## Pasos del sprint

### S2-01 — Entorno de desarrollo: ESLint + CI — ❌ eliminado (2026-10-18)
- Fuera del sprint por decisión del usuario.

### S2-02..S2-05 — Motor — ✅ ya cerrado
- Modelo de cartas, mazo 40, RNG con semilla (FNV-1a equivalente a mulberry32).
- Reparto, triunfo visible, bazas, fuerza y puntos, 10 de últimas.
- Robo, arrastre, `legalActions` (servir/superar/fallar, regla del compañero).
- Cantes 20/40 y cambio del 7.
- Tests: 26 tests en `packages/engine/tests/` (deal, scoring, flow, lastTrickTiming, legalPlays, arrastreEntrance, cantes, swapSeven, swapSevenBotE2E).
- 0 d (no tocar).

### S2-06 — Motor: MatchScoring — ✅ cerrado (2026-10-18)
- `packages/engine/src/matchScoring.ts`: interfaz `MatchScoring` (`start`, `recordPartida`, `champion`, `leader`) con la implementación `firstToN(n)` / `FIRST_TO_3` (partidas rápidas, S2-13). Inmutable y pura.
- `nextHandSetup(prev)`: dealer ("el que corta, reparte") y continuación de la siguiente mano (misma partida → vuelta + 1; partida cerrada → vuelta 1 y marcadores a cero). Antes estaba copiado en el server y en los tests.
- El server (`room.ts`) ya no decide el formato del match: usa `MATCH_SCORING = FIRST_TO_3` y `nextHandSetup`. Los "cotos" de partidas privadas (S3+) serán otra implementación de `MatchScoring`.
- El cierre de la PARTIDA (umbral de 100) sigue en `apply` (`maybeEndMatch`), como estaba.
- Tests: `packages/engine/tests/matchScoring.test.ts` (7).

### S2-07 — Protocolo — ❌ cancelado en este sprint
- Por decisión del usuario: no migrar al envelope `{v:1, t:..., seq, expectSeq}` ni añadir `seq`/`clientActionId`. `commandId` UUID sigue siendo la fuente de idempotencia.
- Se reactiva en Sprint 3 si surge un segundo cliente (app nativa) o si el matchmaking requiere `seq` para resincronización.

### S2-08 — Sesión invitado (token UUID) — ✅ cerrado
- Token UUID opaco persistido en `room.players[].token` con 90 s de backoff para reclamar seat.
- No se mete JWT en Sprint 2 (decisión §arriba). JWT se reconsidera si en Sprint 3 escalamos a múltiples instancias del server.

### S2-09 — Servidor: Table — ✅ cerrado
- Máquina de estados en `apps/server/src/room.ts:74-203`, `autoPlayTimer` con heurística de fallback, `scheduleAutoPlay` (10 s), `broadcastView` por seat, `viewFor` redactado en `packages/engine/src/viewFor.ts:57-93`.
- 0 d (no tocar).

### S2-10 — Bots nivel 1 y 2 + retardo de pensar — ✅ cerrado (2026-10-18)
- `packages/bots/src/level.ts`: `BotLevel = 1 | 2` y `botAction(state, seat, level)` (L1 = acción legal al azar, L2 = heurística). `Room.botLevel` (por defecto 2, se guarda en el snapshot); `POST /api/rooms` acepta `botLevel` opcional (aún sin selector en la UI).
- Retardo de "pensar": `botThinkDelayMs()` aleatorio de 600-1500 ms antes de cada acción de bot (sustituye al 1 s fijo de `stepBots` y del handler de ACTION).
- Test de estrés `packages/bots/tests/stress.test.ts`: partidas completas bot contra bot en 3 modos (L1 vs L1, L2 vs L2, L1 vs L2), comprobando en cada acción que es legal y que el motor no lanza, y en cada mano completa 40 cartas y 120 + 10 + cantes puntos. Determinista (semillas + PRNG). 300 partidas/modo en `npm test`; completo con `STRESS_GAMES=10000 npm run stress -w @guinote/bots`.
- Resultado con 10 000 partidas por modo (30 000 en ~10 s): 0 acciones ilegales, 0 cuelgues, invariantes OK. L2 gana a L1 el 84 % de las partidas.
- Pendiente (S3): elegir el nivel del bot de relleno según el rating medio de la mesa (parte de S2-11).

### S2-11 — Matchmaking con rating — ➡️ movido a Sprint 3 (S3-05)
- Hecho en el server: cola con tickets por rating, ventana creciente y equipos con compañeros enfrentados (`apps/server/src/matchmaking.ts`, `/ws/matchmake`, tick cada 1 s).
- Pendiente (S3-05): conectar "Jugar online" de la web a esa cola (hoy usa el lobby antiguo `POST /api/rooms/matchmake`) y elegir el nivel del bot de relleno por el rating medio. Se junta con la "pareja fija" (S3-04), que también necesita la cola.

### S2-12 — Desconexión, sustitución por bot — ✅ cerrado (2026-10-18)
- Decisiones (2026-10-18): **sin reclamar** el asiento tras los 45 s; **abandonar a mitad de partida = derrota de ELO**.
- `substituteWithBot` (`apps/server/src/room.ts`): tras 45 s sin reconectar, o al instante con `LEAVE` a mitad de partida, el asiento pasa a bot definitivo (`substitute: true`, se conserva el nombre y la UI lo marca con "🤖 bot"; token y `playerId` borrados). Si le tocaba, el bot juega ya.
- ELO del abandono: derrota contra el rating medio de los rivales humanos (sin rivales humanos no cuenta). El que abandona sale del cálculo de fin de partida (no se le penaliza dos veces).
- Sin reclamar: `room.abandonedPlayerIds` + asientos `substitute` no ocupables; si vuelve recibe `ERROR SEAT_LOST` y el cliente olvida la sala.
- Mientras el humano está desconectado (ventana de 45 s) el auto-play juega a los 2 s en vez de 10 s.
- Mensaje nuevo `SEATS {seatNames, seatKinds: human|disconnected|bot|substitute}` → base para la UI de S2-15.
- En lobby, `LEAVE`/expiración liberan el asiento y borran el `playerId` (nadie hereda ELO ajeno).
- Tests: `apps/server/tests/substitute.test.ts` (6).

### S2-13 — Revancha (primera a 3 partidas) — ✅ cerrado (2026-10-18)
- Implementado: `Room.matchWins` / `postgame` / `matchEndReason` en `apps/server/src/room.ts` (`openPostgame`, `castRematchVote`, `resolvePostgame`, `closeMatch`, `abandonDuringPostgame`, `sendPostgameStateTo`); `REMATCH_VOTE` → `REMATCH_STATUS` / `MATCH_ENDED {winner|null, reason, matchWins}` en `packages/protocol/src/wire.ts` (único cambio de protocolo del sprint: mensajes nuevos, sin tocar el envelope); panel de votación con cuenta atrás + marcador "Partidas · a 3" en `apps/web/src/pages/Game.tsx`; tests en `apps/server/tests/rematch.test.ts` (8).
- Detalles: los bots votan `yes` automáticamente; `LEAVE` durante el postgame = `no`; un `no` cierra al instante; empate en el cierre → `winner: null`; quien reconecta recibe el `REMATCH_STATUS` / `MATCH_ENDED` vigente; `triggerNextHand` es no-op con postgame abierto (evita contar la partida dos veces); la partida nueva resetea `cumulativeTeamPts` y buenas/malas.
- Diseño (decidido el 2026-10-17): **se elimina el concepto de "coto" del flujo de revancha**. Una "partida" = una mano completa con su score de equipo (≤ 100 puntos). El flujo es:
  1. Termina una partida.
  2. El server abre un `postgame` de 20 s con `rematch.status` (votos `pending`/`yes`/`no` por seat).
  3. Si todos los humanos votan `yes` antes del deadline, se inicia **una nueva partida** (mismos seats, repartidor rotado, mazo nuevo, contadores `matchWins` por equipo incrementados).
  4. Gana el **primer equipo que llegue a 3 partidas** (`matchWins >= 3`). En ese momento el server emite `matchEnded` y la mesa pasa a `closed`.
  5. Si algún humano vota `no`, expira el deadline sin unanimidad, o se abandona un seat, la mesa se cierra: `matchEnded` con el equipo que lleve más `matchWins` en ese momento (o empate).
- Estado de mesa: `forming → playing → postgame → (playing | closed)`.
- Contador `matchWins: Record<TeamId, number>` en `Room` (inicial 0-0 al crear la sala).
- Implementación: mensajes `rematch.vote` (cliente → server), `rematch.status` (server → cliente), `matchEnded` (server → cliente).
- "Coto" como concepto se **reserva para partidas privadas en Sprint 3+** (cuando haya cuentas y lobbies privados con código).
- Ventana de reconexión: **45 segundos** (`RECONNECT_WINDOW_MS`; era 90 s, reducida el 2026-10-18).
- ~1 d.

### S2-14 — Persistencia Cosmos — ✅ cerrado (2026-10-18)
- Snapshot completo de la sala (`apps/server/src/snapshot.ts`): estado del motor, asientos (nombre, token, `playerId`, sustituto), `matchWins`, votación abierta, abandonos. En `snapshots` con `id = tableId` (un documento por mesa; antes el upsert sin `id` acumulaba documentos) y TTL 24 h.
- Cuándo se guarda (decisión 2026-10-18: **al final de cada mano**, no por baza): fin de mano (también la cortada por cante), reparto de cada mano, apertura de la votación de revancha, humano que se sienta en una mesa ya repartida, sustitución por bot, y SIGTERM (estado actual). Al cerrarse el match se borra. Los lobbies no se guardan.
- Si el server cae a mitad de mano, la mano se reanuda desde el reparto (mismas cartas); lo jugado en esa mano se pierde.
- Rehidratación al arrancar (`resumeRestoredRoom` en `room.ts`): los humanos empiezan desconectados con su ventana de 45 s (el cliente reconecta solo con su token, S2-15); a los 8 s se reanuda: mano en curso → se juega; mano terminada → siguiente mano o votación; votación abierta → se reabre con 20 s nuevos sin volver a contar la partida. Snapshots antiguos (`{ code }`), duplicados o de matches cerrados se borran.
- `room.ts` no importa nada de Cosmos: guarda vía `persistHooks.ts` (sink registrado en `index.ts`; con backend `memory` es no-op).
- Tests: `apps/server/tests/snapshot.test.ts` (8).

### S2-15 — Web: indicador de seat desconectado + reconexión — ✅ cerrado (2026-10-18)
- Asientos: `SEATS` trae `seatKinds` + `reconnectDeadlines`; la mesa pinta "📡 N s" (cuenta atrás de los 45 s, avatar atenuado) y "🤖 bot" (avatar con borde discontinuo) para el sustituto.
- Mi conexión (`store.ts`): al caerse el WS, aviso "Conexión perdida — reconectando…" y reintentos con mi token (1 s, 2 s, 4 s, máx. 5 s) durante 45 s; reintento inmediato al volver la app al primer plano (`visibilitychange`) o recuperar la red (`online`). `SEAT_LOST` / `ROOM_NOT_FOUND` / ventana agotada → tarjeta "Has perdido tu asiento" + "Volver al inicio" (`components/ConnectionBanner.tsx`).
- Misma partida en otra pestaña: `ERROR SESSION_REPLACED` a la vieja, que deja de reconectar (evita que dos pestañas se roben el asiento en bucle).
- "Jugar con jugadores" ya no vuelve a ciegas a `lastRoomCode`: pregunta `GET /api/rooms/:code/seat?token=` y, si la sala está muerta/cerrada o el asiento ya no es suyo, va al matchmaking normal.
- Servidor: un token de la sala que ya no corresponde a ningún asiento (partida empezada) recibe `SEAT_LOST` en vez de otro asiento libre.
- Latido WS (ping cada 5 s, `HEARTBEAT_MS`): un móvil sin red se detecta en ~5-10 s (antes el WS no se cerraba y la mesa esperaba 10 s por turno). Con el jugador desconectado, su turno lo juega el auto-play a los 2 s.

### S2-16 — Despliegue: Azure Container Apps — 🧑‍💻 manual (usuario)
- Lo hace el usuario a mano (decisión 2026-10-18). Notas útiles: `PERSISTENCE_BACKEND=cosmos` + `COSMOS_ENDPOINT` / `COSMOS_DATABASE`; `minReplicas = maxReplicas = 1` (las salas viven en memoria); ingress con WebSocket; dar margen al SIGTERM (`terminationGracePeriodSeconds` ≥ 30) para que se guarden los snapshots; `/healthz` para el health probe.

### S2-17 — ELO anónimo con cookie — ✅ cerrado (2026-10-18)
- Cookie httpOnly `guinote_pid` (90 días) + documento en `players` (Cosmos) con `rating`, `games`, `wins`, `losses`. K = 40 las 10 primeras partidas, luego 20. Rating inicial 1000.
- Solo cuenta con al menos un humano en cada equipo. Abandonar a mitad de partida = derrota (S2-12).
- Probado de punta a punta el 2026-10-18 (portátil + móvil).
- Pendiente (Sprint 4): `ratingHistory` por match, para historial y rachas. Mostrar ELO en la UI: Sprint 4, ya con cuentas.

---

## Estimación total recalibrada

| Tarea | Original | Recalibrada |
|---|---|---|
| S2-01 ESLint + CI | 0.5 d | 0.25 d |
| S2-06 MatchScoring | 1 d | 0.5 d |
| S2-07 Protocolo | 1 d | ❌ cancelado |
| S2-08 Sesión invitado | 1 d | ✅ cerrado |
| S2-10 Bots L1/L2 + stress | 1.5 d | 0.7 d |
| S2-11 Matchmaking con rating | 1.5 d | 0.7 d |
| S2-12 Sustitución por bot | 1.5 d | 0.7 d |
| S2-13 Revancha | 1 d | 1 d |
| S2-14 Cosmos | 2 d | 2 d |
| S2-15 Indicador seat desc. | 4 d | 0.5 d |
| S2-16 ACA + CI deploy | 1 d | 1 d |
| S2-17 ELO anónimo | 0.5 d | 0.5 d |
| **Total Sprint 2** | **23 d** | **~8.25 d** |

---

## Cómo arrancar este sprint

Asumiendo el estado actual (Sprint 1 cerrado, motor y servidor base cerrados):

```
# 1. S2-14 primero (Cosmos) — bloquea S2-11 (matchmaking necesita rating persistido)
# 2. S2-17 segundo (ELO) — bloquea S2-11
# 3. S2-11 (matchmaking) — usa S2-17
# 4. S2-12 (sustitución bot) — independiente
# 5. S2-13 (revancha) — independiente
# 6. S2-06 (MatchScoring) — refactor, se puede intercalar
# 7. S2-10 (bots L1/L2 + stress) — independiente
# 8. S2-01 (ESLint + CI) — independiente, se puede hacer primero
# 9. S2-15 (UI seat desc.) — bloquea S2-16 (UI feedback del deploy)
# 10. S2-16 (ACA + deploy) — último, smoke post-deploy
```

Paralelizable (mientras otra persona trabaja en otra tarea):
- S2-01 (CI) puede ir desde el día 1.
- S2-15 (UI) puede ir desde el día 1, no bloquea el server.

---

## Cambios de código previstos

| Archivo | Cambio |
|---|---|
| `apps/server/Dockerfile` | Activar HEALTHCHECK con wget |
| `infra/` (nuevo) | bicep con Container App + Container Apps Environment + secretos |
| `.github/workflows/test.yml` (nuevo) | `npm run typecheck` + `npm test` + `npm run lint` en PRs |
| `.github/workflows/deploy.yml` (nuevo) | Build ACR + update Container App en push a `main` |
| `packages/engine/src/matchScoring.ts` (nuevo) | Interfaz `MatchScoring` + implementación provisional |
| `apps/server/src/cosmos.ts` (nuevo) | Cliente Cosmos, helpers para players/matches/snapshots |
| `apps/server/src/elo.ts` (nuevo) | Cálculo ELO con K alto/bajo |
| `apps/server/src/rehydrate.ts` (nuevo) | Carga snapshots no caducados al arrancar |
| `apps/server/src/index.ts` | Wire cookie, middleware ELO, hooks de Cosmos en fin de mano/partida/SIGTERM |
| `apps/server/src/room.ts` | Bot-takeover definitivo tras 90 s, estado `postgame`, `matchWins: Record<TeamId, number>`, `rematch.vote`/`rematch.status`/`matchEnded` handlers, máquina `forming → playing → postgame → (playing \| closed)` |
| `apps/server/src/rooms.ts` | Cola de matchmaking con rating, ventana ±100/+50, formación de equipos |
| `packages/bots/src/{random,heuristic}.ts` | Exponer `level: 1 \| 2`, delay 600-1500 ms por acción |
| `packages/bots/tests/stress.ts` (nuevo) | 10 000 partidas bot-vs-bot por modo sin acciones ilegales |
| `packages/protocol/src/wire.ts` | **No tocar** (decisión S2-07 cancelada) |
| `apps/web/src/store.ts` | Manejo de cookie + rematch.vote |
| `apps/web/src/pages/Game.tsx` | Indicador visual de seat desconectado + UI de revancha |
| `apps/web/src/pages/Home.tsx` | Quitar entrada por código cuando entre matchmaking (S3-??) |

---

## Riesgos y caveats

- **Cosmos free tier**: 1000 RU/s compartidos es justo para producción. Si metemos escrituras por acción, agotamos el tier. Por eso S2-14 escribe solo al final de mano / partida / SIGTERM. Estimar el consumo con Data Explorer antes de abrir al público.
- **ACA min=max=1**: si el contenedor cae, las mesas en curso dependen de los snapshots en Cosmos para rehidratarse. El reinicio puede durar 30-60 s (startup del contenedor + bucle de rehidratación). Aceptable para MVP.
- **ELO anónimo**: un usuario que cambia de dispositivo o borra cookies pierde su rating. Decisión consciente: la fricción de cuentas reales se aplaza a Sprint 4.
- **Partidas con bots no cuentan para ELO**: pendiente de confirmar al implementar. Si quieres que cuenten (con K más bajo), avísame.
- **Sin auth**: cualquiera con el código puede unirse y abandonar. La penalización por `abandons` está prevista para Sprint 4.
- **HEALTHCHECK activo puede romper ACA**: si el check falla, ACA reinicia el contenedor. Hay que asegurar que `/healthz` responde 200 incluso mientras las salas se rehidratan.

---

## Decisiones para Sprint 3

Resueltas el 2026-10-18 en [`SPRINT3.md`](SPRINT3.md) (auth, mesas privadas, pareja fija, matchmaking, coto, i18n, app nativa, ranking).
