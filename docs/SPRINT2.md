# Sprint 2 — Partidas rápidas y revancha

**Goal**: de la home a una mesa en ≤ 2 toques, con rivales de nivel parecido, bots para completar, reconexión y revancha en 1 toque. Persistencia real en Cosmos, deploy permanente en Azure Container Apps, ELO anónimo ya activo para preparar matchmaking de Sprint 3.

**Estado a fecha 2026-10-17**: sprint arrancado, listo para empezar a implementar. Estimación recalibrada a ~8.25 días (frente a los ~23 d del plan original) porque el motor y el servidor base ya están cerrados desde Sprint 0/1.

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

### S2-01 — Entorno de desarrollo: ESLint + CI — 🟡 parcial
- Ya tenemos: monorepo npm workspaces, TS estricto (`tsconfig.base.json`), prettier.
- Falta: `eslint.config.*`, workflows de GitHub Actions para `pnpm test` (cambiar a `npm test`) y `npm run typecheck` en cada PR.
- Hecho cuando CI verde en PR con `npm test` + `npm run typecheck` + `npm run lint`.
- ~0.25 d.

### S2-02..S2-05 — Motor — ✅ ya cerrado
- Modelo de cartas, mazo 40, RNG con semilla (FNV-1a equivalente a mulberry32).
- Reparto, triunfo visible, bazas, fuerza y puntos, 10 de últimas.
- Robo, arrastre, `legalActions` (servir/superar/fallar, regla del compañero).
- Cantes 20/40 y cambio del 7.
- Tests: 26 tests en `packages/engine/tests/` (deal, scoring, flow, lastTrickTiming, legalPlays, arrastreEntrance, cantes, swapSeven, swapSevenBotE2E).
- 0 d (no tocar).

### S2-06 — Motor: MatchScoring — 🟡 parcial
- Hoy: `VueltasScoring` con `threshold: 100` y `PartidaScore {buenas, malas}` viven en `packages/engine/src/rules.ts:121-125` y `state.ts:74`. El cierre de coto/match (`partidas/cotos/matchFinished`) está en el server (`apps/server/src/room.ts:113-139`), no en el motor.
- Falta: extraer la lógica de cierre a una interfaz `MatchScoring` en el motor, con una implementación provisional hasta cerrar las reglas de "malas/buenas/vueltas" (decisión §10 del plan original).
- ~0.5 d.

### S2-07 — Protocolo — ❌ cancelado en este sprint
- Por decisión del usuario: no migrar al envelope `{v:1, t:..., seq, expectSeq}` ni añadir `seq`/`clientActionId`. `commandId` UUID sigue siendo la fuente de idempotencia.
- Se reactiva en Sprint 3 si surge un segundo cliente (app nativa) o si el matchmaking requiere `seq` para resincronización.

### S2-08 — Sesión invitado (token UUID) — ✅ cerrado
- Token UUID opaco persistido en `room.players[].token` con 90 s de backoff para reclamar seat.
- No se mete JWT en Sprint 2 (decisión §arriba). JWT se reconsidera si en Sprint 3 escalamos a múltiples instancias del server.

### S2-09 — Servidor: Table — ✅ cerrado
- Máquina de estados en `apps/server/src/room.ts:74-203`, `autoPlayTimer` con heurística de fallback, `scheduleAutoPlay` (10 s), `broadcastView` por seat, `viewFor` redactado en `packages/engine/src/viewFor.ts:57-93`.
- 0 d (no tocar).

### S2-10 — Bots nivel 1 y 2 + retardo de pensar — 🟡 parcial
- Hoy: 1 bot heurístico (`packages/bots/src/heuristic.ts`) + 1 bot random (`packages/bots/src/random.ts`).
- Falta: parametrizar como `level: 1 | 2` (L1 = random, L2 = heurístico), añadir delay artificial de 600-1500 ms por acción (hoy el delay lo aplica el server con `setTimeout(1000)` entre bazas en `apps/server/src/index.ts:295`, no el bot), test de stress de 10 000 partidas bot-vs-bot por modo sin acciones ilegales.
- ~0.7 d.

### S2-11 — Matchmaking con rating — 🟡 parcial
- Hoy: `apps/server/src/rooms.ts:36-66` (`findOrCreateMatchmakeRoom`) prioriza "más humanos primero" con ventana de lobby de 30 s. **No hay rating**.
- Falta: introducir rating (depende de S2-17), cola con tickets `{playerId, mode, fill, rating, enqueuedAt}`, ventana ±100/+50 cada 5 s con tope ±400, formación de equipos `(a, d) vs (b, c)` (compañeros enfrentados), relleno con bots de nivel acorde al rating medio.
- ~0.7 d.

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

### S2-14 — Persistencia Cosmos — ⏳ no empezado
- Hoy: todo en `apps/server/src/rooms.ts:4` (`const rooms = new Map<string, Room>()`). Reiniciar el server borra todas las mesas.
- Plan:
  - Contenedor Cosmos con throughput compartido 1000 RU/s.
  - 3 contenedores: `players` (PK `/id`), `matches` (PK `/id`), `snapshots` (PK `/tableId`, TTL 24 h).
  - Cliente `@azure/cosmos`.
  - Escrituras solo al final de mano, fin de partida y SIGTERM (no por acción).
  - Rehidratación al arrancar: cargar snapshots no caducados, reconstruir `Room` con `replay()` o estado directo, marcar asientos humanos como `human_disconnected`.
  - Variables de entorno: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE`.
- ~2 d.

### S2-15 — Web: indicador de seat desconectado + reconexión — ✅ cerrado (2026-10-18)
- Asientos: `SEATS` trae `seatKinds` + `reconnectDeadlines`; la mesa pinta "📡 N s" (cuenta atrás de los 45 s, avatar atenuado) y "🤖 bot" (avatar con borde discontinuo) para el sustituto.
- Mi conexión (`store.ts`): al caerse el WS, aviso "Conexión perdida — reconectando…" y reintentos con mi token (1 s, 2 s, 4 s, máx. 5 s) durante 45 s; reintento inmediato al volver la app al primer plano (`visibilitychange`) o recuperar la red (`online`). `SEAT_LOST` / `ROOM_NOT_FOUND` / ventana agotada → tarjeta "Has perdido tu asiento" + "Volver al inicio" (`components/ConnectionBanner.tsx`).
- Misma partida en otra pestaña: `ERROR SESSION_REPLACED` a la vieja, que deja de reconectar (evita que dos pestañas se roben el asiento en bucle).
- "Jugar con jugadores" ya no vuelve a ciegas a `lastRoomCode`: pregunta `GET /api/rooms/:code/seat?token=` y, si la sala está muerta/cerrada o el asiento ya no es suyo, va al matchmaking normal.
- Servidor: un token de la sala que ya no corresponde a ningún asiento (partida empezada) recibe `SEAT_LOST` en vez de otro asiento libre.
- Latido WS (ping cada 5 s, `HEARTBEAT_MS`): un móvil sin red se detecta en ~5-10 s (antes el WS no se cerraba y la mesa esperaba 10 s por turno). Con el jugador desconectado, su turno lo juega el auto-play a los 2 s.

### S2-16 — Despliegue: Azure Container Apps — ⏳ no empezado
- Hoy: `apps/server/Dockerfile` (multi-stage, `node:22-alpine`), con `HEALTHCHECK` comentado.
- Plan:
  - Activar `HEALTHCHECK` con `wget --spider http://127.0.0.1:3001/healthz` (el endpoint ya existe en `apps/server/src/index.ts:51`).
  - Definir `infra/` con bicep o terraform para ACA (env: `bicep` por familiarity).
  - Container App con `minReplicas = maxReplicas = 1`, ingress HTTP+WS, secrets de Cosmos/JWT/CORS, variables de entorno, ping cada ~25 s para mantener WS activas.
  - `terminationGracePeriodSeconds` suficientemente alto (≥ 60 s) para que `SIGTERM` dispare la escritura de snapshots.
  - GitHub Actions: workflow `deploy.yml` que construye la imagen y la sube a ACR + actualiza la Container App.
  - Smoke e2e post-deploy: dos pestañas, misma sala, una mano completa (sustituye al smoke cancelado del Sprint 1).
- ~1 d.

### S2-17 — ELO anónimo con cookie — ⏳ no empezado
- Plan:
  - Cookie httpOnly + sameSite=lax con `playerId` UUID (generado en primer login si no existe).
  - Al terminar partida: K alto provisional (K = 40) para nuevos, K = 20 para establecidos. Rating inicial 1000.
  - Partidas con ≥ 2 humanos sí actualizan ELO; partidas con solo bots no actualizan (decisión a confirmar al implementar).
  - Persistir `ratingHistory` en el documento `match` de Cosmos.
  - **No mostrar ELO en UI todavía** — queda como dato en background para el matchmaking de Sprint 3 (S3-??).
- ~0.5 d.

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

## Decisiones a tomar para Sprint 3

1. Matchmaking puro con rating (cola, ventana, equipos) ya en S3, o lo dejamos como MVP de S2.
2. Cuentas reales (OAuth o Entra External ID) — Sprint 3 o Sprint 4.
3. **Partidas privadas con "coto"** (varias partidas con score acumulado tipo malas/buenas) — ¿Sprint 3 o Sprint 4? Reservado tras la decisión del 2026-10-17 de sacarlo del flujo de revancha.
4. App nativa (React Native o Capacitor) — ¿vale la pena?
5. i18n es/en — ¿Sprint 3?
6. Ranking público y ELO visible en UI — ¿Sprint 3?