# Sprint 6 — Web en Azure Static Web Apps

**Goal**: la web (HTML, JS, cartas, páginas públicas) se sirve desde **Azure Static Web Apps** (CDN, plan gratuito) y el contenedor queda solo para la **API y los WebSockets**. Así la portada y "Cómo se juega" cargan al instante aunque el servidor esté escalado a 0, y Google siempre encuentra la web rápida.

**Estado a fecha 2026-10-23**: código hecho (S6-01, S6-02 y la parte de código de S6-03). Falta el despliegue en Azure y el DNS (S6-04, pasos 1–7), que hace Jose.

---

## Decisiones

| Eje | Decisión | Notas |
|---|---|---|
| Dominios | **`www.guinoteonline.es`** → Static Web Apps (web, dirección principal) · `api.guinoteonline.es` → Container App (API + `wss://`) · `guinoteonline.es` (raíz) → sigue en la Container App, que redirige con 301 a `www` (`CANONICAL_HOST`) | Mismo "sitio" para el navegador: las cookies siguen funcionando (sin cookies de terceros). |
| Cookies | `Domain=.guinoteonline.es`, `SameSite=Lax`, `Secure` | Valen para la web y para `api.`. |
| CORS | Solo `https://www.guinoteonline.es` (y el raíz, por la transición), con credenciales; preflight cacheado (`Access-Control-Max-Age: 7200`) | El juego va por WebSocket: sin coste extra. |
| Transición | El contenedor sigue pudiendo servir la web (`SERVE_WEB=true`) hasta que todo funcione | Marcha atrás = volver a apuntar el DNS. |
| Repositorio | **Un solo repo** (el actual). Static Web Apps despliega solo `apps/web` con un workflow propio; el contenedor sigue con su despliegue. | La web usa `packages/protocol` y `packages/engine`: separarla obligaría a copiar o publicar esos paquetes. Si más adelante se quiere un repo aparte, ver nota al final. |
| Rendimiento | La partida no cambia (mismo WebSocket al mismo contenedor). Primera carga más rápida (CDN) y sin espera de arranque. | Coste: una conexión más al entrar (decenas de ms). |

---

## Tareas, en orden

### S6-01 — La web habla con la API por su dirección — ✅ hecho
`apps/web/src/api.ts` (`apiFetch`, `apiUrl`, `wsUrl`); todas las llamadas pasan por ahí.
- `VITE_API_ORIGIN` al compilar (vacío = mismo origen, como ahora, para desarrollo y para la transición).
- Un único `apiFetch()` / `wsUrl()` en la web: todas las llamadas con `credentials: 'include'` y la URL completa; WebSockets (`/ws/matchmake`, `/ws/<sala>`) a `wss://api.guinoteonline.es`.
- Revisar todo lo que hoy usa rutas relativas: `store.ts`, `account.ts`, `party.ts`, `friends.ts`, `penas.ts`, `torneos.ts`, `push.ts`, Perfil (descargar mis datos), Ranking, etc.
- Los enlaces de invitación (`window.location.origin`) siguen apuntando a la web: no cambian.

### S6-02 — El servidor, preparado para otro origen — ✅ hecho
`apps/server/src/crossOrigin.ts` + `tests/crossOrigin.test.ts`. Variables: `ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, `SERVE_WEB` (ver `.env.example`). Con `SERVE_WEB=false`, `/` responde `{ ok, api }`.
- `ALLOWED_ORIGINS` (lista) en CORS, con credenciales y `Access-Control-Max-Age`. Comprobar `Origin` también en el handshake de los WebSockets.
- `COOKIE_DOMAIN=.guinoteonline.es` para `guinote_sid` y `guinote_pid`. **Migración**: desplegar esto ANTES de mover el DNS; al pasar por `/api/me` se reescriben las cookies con el dominio nuevo, así nadie pierde la sesión al cambiar.
- `SERVE_WEB` (por defecto `true`): al final se pone a `false` y el contenedor deja de servir la web; `CANONICAL_HOST` deja de hacer falta en el contenedor.
- `/api/health` sigue respondiendo sin tocar la base de datos.

### S6-03 — Static Web App — código ✅, despliegue pendiente
Hecho: `apps/web/public/staticwebapp.config.json` (páginas `/como-se-juega` y `/privacidad` prerenderizadas, vuelta a `index.html` para el resto, caché de `assets/` un año y del HTML/SW siempre fresco) y `docs/swa-workflow.yml` (el workflow para pegar encima del que genera Azure).

Al crear la Static Web App en el portal: plan **Free**, origen **GitHub**, rama `main`, preset **Custom**, *App location* `apps/web`, *Output location* `dist`. Azure sube un workflow a `.github/workflows/`; se sustituye su contenido por `docs/swa-workflow.yml` conservando el nombre del secreto.

Variables del contenedor (paso 1): `ALLOWED_ORIGINS=https://www.guinoteonline.es,https://guinoteonline.es`, `COOKIE_DOMAIN=.guinoteonline.es`. Para probar en `*.azurestaticapps.net` (paso 3) hay que añadir esa dirección a `ALLOWED_ORIGINS` un rato; ahí no habrá sesión (las cookies son de `guinoteonline.es`), solo comprobar que carga y se puede jugar como invitado.

**La web principal es `www.guinoteonline.es`** (Static Web Apps no lleva bien el dominio raíz sin ALIAS/ANAME). En la Static Web App solo se añade `www` (CNAME). El dominio raíz se queda apuntando a la Container App (ya lo hace) y, con `CANONICAL_HOST=www.guinoteonline.es`, redirige con 301 a `www` todas las páginas (no `/api` ni `/ws`). Así también siguen funcionando los enlaces viejos y las apps instaladas desde el raíz.

- `apps/web/public/staticwebapp.config.json`:
  - `navigationFallback` → `/index.html`, excluyendo `/assets/*`, `/cards/*` y ficheros con extensión.
  - Rutas `/como-se-juega` y `/privacidad` a su HTML ya generado.
  - Cabeceras: `/assets/*` caché de un año (`immutable`); `index.html`, `sw.js` y `manifest.webmanifest` sin caché.
  - Tipos MIME (`.webmanifest`).
- `guinoteonline.es` → `www.guinoteonline.es` (301 desde la Container App con `CANONICAL_HOST`).
- Workflow de GitHub Actions (`Azure/static-web-apps-deploy`): `npm ci` en la raíz, compilar `protocol` y `web` con `VITE_API_ORIGIN=https://api.guinoteonline.es`, subir `apps/web/dist` (sin que la acción vuelva a compilar). Secreto `AZURE_STATIC_WEB_APPS_API_TOKEN`.

### S6-04 — Cambio de DNS y comprobaciones — ~0,5 d
Orden (cada paso se puede deshacer):
1. Desplegar el servidor con S6-02 (cookies con dominio, CORS) — la web sigue saliendo del contenedor.
2. Añadir `api.guinoteonline.es` a la Container App (CNAME + TXT `asuid.api`, certificado gratis).
3. Crear la Static Web App y desplegar la web apuntando a `api.`; probarla en su dirección `*.azurestaticapps.net` (lo que no use la sesión).
4. Apuntar `www` (CNAME) a la Static Web App y poner `CANONICAL_HOST=www.guinoteonline.es` en el contenedor. Añadir `https://www.guinoteonline.es` a los orígenes autorizados de Google (OAuth).
5. Probar: entrar con Google, jugar online y en pareja, mesa privada, amigos y avisos, peñas, torneos, instalar la app, "Cómo se juega" sin JavaScript.
6. Poner `SERVE_WEB=false` en el contenedor.
7. Search Console: con una propiedad de tipo **dominio** (`guinoteonline.es`) entran `www` y el raíz a la vez; enviar `https://www.guinoteonline.es/sitemap.xml`. Los 301 del raíz bastan para que Google pase a `www`.

---

## Riesgos
- **Cambio de origen (raíz → `www`)**: para el navegador son webs distintas. La sesión no se pierde (cookies con `Domain=.guinoteonline.es`), pero: los avisos push hay que volver a activarlos en `www` (los antiguos siguen llegando y al pulsarlos redirigen); la app instalada desde el raíz abre con barra del navegador tras el 301, mejor reinstalarla; lo guardado en el navegador (preferencias locales) empieza de cero.
- **Cookies antiguas**: las que se pusieron sin dominio solo valen en el host exacto; por eso el paso 1 va antes que el cambio de DNS.
- **Avisos push**: el service worker vive en el origen de la web (no cambia), pero las suscripciones se guardan llamando a la API: comprobar en el paso 5.
- **Límites del plan gratuito** de Static Web Apps (100 GB de tráfico al mes): de sobra para empezar.

**Total estimado: ~2 días.**

## Nota: ¿repo aparte para la web?
No hace falta: el workflow de Static Web Apps compila y sube solo la web desde este mismo repo (y se puede limitar a que salte solo cuando cambian `apps/web/**` o `packages/**`). Si aun así se quiere separar:
- Opción A: publicar `@guinote/protocol` y `@guinote/engine` como paquetes (GitHub Packages) y que los dos repos los instalen con versión.
- Opción B: repo de la web con los paquetes copiados (más simple, pero hay que mantenerlos sincronizados a mano).
