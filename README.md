# Guiñote aragonés

SaaS de guiñote aragonés para móvil. 4 jugadores, 2 parejas, baraja española de 40.

## Stack

- **Motor de reglas** (`packages/engine`): TypeScript puro, determinista, sin I/O. `seed + log` reproduce cualquier partida.
- **Protocolo** (`packages/protocol`): comandos WebSocket + eventos, validados con zod.
- **Bots** (`packages/bots`): heurística mínima (random legal), hueco para ISMCTS más adelante.
- **Server** (`apps/server`): Fastify + WebSocket, una sala por actor en memoria con cola serializada.
- **Web** (`apps/web`): PWA mobile-first con React + Vite + Zustand.

## Reglas

Definidas en [`docs/guinote-aragones-diseno.md`](./docs/guinote-aragones-diseno.md). El motor las ejecuta; el servidor las valida; el cliente las pinta (resaltando cartas legales).

## Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm install` | Instala dependencias de todos los paquetes. |
| `pnpm dev` | Arranca server y web en paralelo (modo watch). |
| `pnpm test` | Ejecuta los tests de todos los paquetes. |
| `pnpm test:engine` | Solo los tests del motor. |
| `pnpm build` | Compila todo (turbo, topológico). |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete. |
| `pnpm lint` | ESLint (cuando se añada). |
| `pnpm format` | Prettier sobre todo. |

## Estructura

```
.
├── apps/
│   ├── cli/        # CLI jugable (debug del motor)
│   ├── server/     # Fastify + WebSocket
│   └── web/        # PWA mobile-first
├── docs/
│   └── guinote-aragones-diseno.md
└── packages/
    ├── bots/       # IA para asientos vacíos
    ├── engine/     # Reglas puras, deterministas
    └── protocol/   # Comandos + eventos (zod)
```

## Estado

Sprint 0 (esta semana): server + PWA mínima para jugar una mano con 3 bots.

Pendiente para siguientes sprints:

- Azure Container Apps + Cosmos DB + Static Web Apps
- Auth real (Entra External ID o login propio)
- Ranking, matchmaking, salas privadas con código
- Señas (diseñadas aparte)
- i18n es/en
- PWA pulida (offline, install prompt, animaciones)
