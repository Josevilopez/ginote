# Sprint 1 — Online mínimo viable

**Goal**: dos personas en dos dispositivos distintos pueden crear una sala, compartir el código, y jugar una mano entera online.

**Estado a fecha 2026-10-17**: ✅ **Sprint cerrado**. Pasos 1, 2, 4, 5, 7 implementados; pasos 3 y 6 cancelados por decisión del usuario (no se va a desplegar con cloudflared ni a hacer smoke e2e real). El motivo: se prioriza producto sobre deploy mientras no haya persistencia ni cuentas. Migración a deploy real se traslada a Sprint 2 (S2-16 Azure Container Apps).

---

## Decisiones (confirmadas el 2026-10-15)

| Eje | Decisión | Razón |
|---|---|---|
| Hosting | **Cloudflare Tunnel sobre portátil local** | 0 €, sin signup, válido para MVP. Riesgo: si el portátil duerme, cae. Migrar a Fly.io / Railway en Sprint 2. |
| Identidad | **Solo código de 4 letras + nickname local** (sin cuentas) | Suficiente para MVP. Cero fricción. |
| Alcance | **Mínimo**: jugar 1 mano online end-to-end | Sin rate limit, sin health checks, sin persistencia cross-restart. |

---

## Pasos del sprint

### 1. Dockerfile del server — ✅ completado
- `apps/server/Dockerfile`: multi-stage con `node:22-alpine`. Builder compila todos los workspaces; runtime copia solo `dist/`, `node_modules` podado y `apps/web/dist`. Listo para mover a cloud cuando lo decidamos.
- `.dockerignore` en la raíz con exclusiones para no inflar el contexto.

### 2. Bundle web estático — ✅ completado
- `npm run build --workspaces --if-present` produce `apps/web/dist/` (172 kB JS + 24 kB CSS).
- El server Fastify ahora sirve esos estáticos desde la misma instancia:
  - `GET /` → `index.html`.
  - `GET /assets/*` → bundle de Vite (cache 1 día, los nombres ya llevan hash).
  - `GET /api/*`, `/ws/*`, `/healthz` → handlers normales.
  - `GET /*` (cualquier otra ruta) → SPA fallback a `index.html`.

### 3. Cloudflare Tunnel — ❌ cancelado
- El usuario decidió el 2026-10-17 no instalar `cloudflared` ni hacer smoke e2e real. Se sustituye por el deploy a Azure Container Apps previsto en Sprint 2 (S2-16).

### 4. CORS — ✅ completado
- `origin: true` mantenido (refleja el Origin del cliente). Funciona tanto para `localhost:5173` (dev) como para `*.trycloudflare.com` (túnel) sin configuración adicional.
- El WS no está sujeto a CORS, así que el handshake inicial siempre cuela.

### 5. Re-unión por token tras desconexión — ✅ parcial
- Implementado: cada seat lleva un `token` UUID persistido. Si el cliente reconecta con `?token=<uuid>`, recupera su seat. La lógica ya estaba en `apps/server/src/index.ts:42-48` y `cryptoToken()` en la línea 161.
- Pendiente (Sprint 2 — S2-12): bot-takeover definitivo cuando alguien se desconecta y no vuelve en 90 s. Hoy, el server hace auto-play heurístico durante el backoff, pero el seat no se convierte en bot.

### 6. Smoke e2e real — ❌ cancelado
- Bloqueado por la cancelación del paso 3. Se sustituye por el smoke e2e contra el deploy real de Azure Container Apps en Sprint 2 (S2-16 + smoke post-deploy).

### 7. Documentación — ✅ completado (este fichero)

---

## Cómo arrancar el entorno local hoy mismo

Asumiendo que ya hay `cloudflared` instalado (paso 3) y el server está en `:3001`:

```
# Terminal 1: server Fastify (sirve también el bundle web)
cd C:\Users\josev\source\repos\guiñote
npm run build -w @guinote/server
npm start -w @guinote/server
# → "guinote server listening on :3001"

# Terminal 2: túnel
cloudflared tunnel --url http://localhost:3001
# → "Your quick Tunnel has been created! https://algo-random.trycloudflare.com"
```

Compartir esa URL con un amigo. Los dos en la URL; uno crea, el otro mete el código (o usa el link con `#ABCD`).

---

## Cambios de código hechos en este sprint

| Archivo | Cambio |
|---|---|
| `apps/server/Dockerfile` | Nuevo. Multi-stage build, listo para deploy cloud. |
| `.dockerignore` | Nuevo. Excluye `node_modules`, `dist`, etc., del contexto. |
| `apps/server/src/index.ts` | Sirve `apps/web/dist` (estático + SPA fallback). Añade `/healthz`. Imports `node:fs/promises`, `node:path`, `node:url`. |
| `apps/web/src/store.ts` | Añade `joinRoom(code)` al state. Valida que el código tenga 4 letras/números. |
| `apps/web/src/App.tsx` | Auto-join desde `window.location.hash` (e.g. `https://host/#ABCD`). |
| `apps/web/src/pages/Home.tsx` | Input "ABCD" + botón "Unirse" para entrar a sala existente. |
| `apps/web/src/styles.css` | `.join-form` y `.join-input` (input grande monoespaciado, foco amarillo). |

---

## Riesgos y caveats del MVP

- **Latencia**: el túnel añade ~20-50 ms. Para jugar con alguien en la misma región va bien; con alguien lejos se nota en la respuesta de los bots.
- **Persistencia**: las salas viven en RAM. Si el server reinicia, todas mueren.
- **Identidad**: cualquiera con el código puede unirse. No hay moderación, no hay auth.
- **CORS permisivo**: aceptamos cualquier Origin. Solo aceptable en MVP.
- **Reconexión parcial**: si te caes, recuperas seat; pero no hay bot-takeover automático.
- **Sin health checks visuales**: si algo se rompe, la UI se queda colgada sin feedback claro. Próximo sprint: un toast "perdimos conexión" cuando el WS cierra.

---

## Decisiones a tomar para Sprint 2

1. ¿Migramos a Fly.io o Railway? Ya tenemos el Dockerfile.
2. ¿Persistencia con SQLite (rooms survive restart) o seguimos en RAM?
3. ¿Cuentas OAuth o nickname persistido por cookie?
4. ¿Health check visual + reconexión 30 s con bot takeover?
5. ¿Dominio propio (guiñote.app o similar)?
