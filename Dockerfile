# Dockerfile para el server de guiñote (Fastify + WebSocket).
# Build multi-stage: compila TypeScript en una imagen, copia artefactos a
# una imagen final mínima.

# ──────────────────────────── Stage 1: build ────────────────────────────
FROM node:22-alpine AS builder

# Directorio de trabajo: la RAÍZ del monorepo, porque usamos npm
# workspaces y los paquetes están enlazados entre sí.
WORKDIR /repo

# Copiamos primero los manifests para cachear npm ci entre builds que
# no cambian dependencias.
COPY package.json package-lock.json* ./
COPY apps/server/package.json      ./apps/server/package.json
COPY apps/web/package.json         ./apps/web/package.json
COPY packages/engine/package.json  ./packages/engine/package.json
COPY packages/bots/package.json    ./packages/bots/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json

# npm ci sólo funciona con lockfile. Si no existe, fallback a install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copiamos el resto del código fuente.
COPY tsconfig.base.json ./
COPY apps/server ./apps/server
COPY apps/web      ./apps/web
COPY packages      ./packages

# Compilamos todos los workspaces que tengan script `build`. El server
# depende de los paquetes, así que hay que construirlos en orden. Usar
# `npm run build --workspaces --if-present` respeta el orden definido
# en las `dependencies` de cada package.json, así que el motor compila
# antes que el server.
RUN npm run build --workspace=@guinote/engine && \
    npm run build --workspace=@guinote/bots && \
    npm run build --workspace=@guinote/protocol && \
    npm run build --workspace=@guinote/server && \
    npm run build --workspace=@guinote/web

# Limpiamos devDependencies en la imagen final para reducir tamaño.
# `npm prune --omit=dev` recorta node_modules a lo necesario en runtime.
RUN npm prune --omit=dev

# ──────────────────────────── Stage 2: runtime ───────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /repo

# Copiamos sólo lo necesario: manifests (para mantener estructura de
# workspaces), código del server, dist de los paquetes, node_modules
# ya podado.
COPY --from=builder /repo/package.json         /repo/
COPY --from=builder /repo/package-lock.json    /repo/
COPY --from=builder /repo/apps/server          /repo/apps/server
# Bundle de la PWA: el server lo sirve desde apps/web/dist (mismo origen).
COPY --from=builder /repo/apps/web/dist        /repo/apps/web/dist
COPY --from=builder /repo/packages             /repo/packages
COPY --from=builder /repo/node_modules         /repo/node_modules

# Nos situamos en la carpeta del server.
WORKDIR /repo/apps/server

# Variables de entorno con defaults sensatos. En producción se
# sobreescriben desde fuera.
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

# Health check simple: el server responde /healthz (lo añadiremos si
# no existe; mientras tanto el wget exit code será 1 y el container se
# considerará unhealthy, que es lo que queremos si el server no
# arrancó). Lo dejamos preparado para el futuro.
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/healthz || exit 1

CMD ["node", "dist/index.js"]
