# Sprint 5 — Pique social

**Goal**: jugar con *tu gente* sin pasar enlaces: amigos que ves conectados y a los que invitas con un toque, avisos aunque no tengan la web abierta, peñas con su ranking, retos entre peñas y torneos.

**Estado a fecha 2026-10-21**: S5-01 a S5-05 hechos (S5-03, S5-04 y S5-05 pendientes de probar en Azure). Quedan los pendientes pequeños.

---

## Decisiones

| Eje | Decisión | Notas |
|---|---|---|
| Orden | Amigos → notificaciones → peñas → retos → torneos | Cada paso se apoya en el anterior (confirmado 2026-10-20). |
| Amigos | **Solo con cuenta.** Se añaden por `Nombre#1234` (o con tu enlace); la otra persona acepta. | Sin cuenta no hay identidad estable. |
| Conectado | "Conectado" = con la web abierta en el último minuto; "Jugando" = sentado en una mesa. | En memoria (una réplica). |
| Invitaciones | Dentro de la app primero (S5-01); fuera, con notificaciones push (S5-02). | Caducan a los 2 minutos. |

---

## Tareas, en orden

### S5-01 — Amigos y quién está conectado — ~1,5 d ✅
- Pantalla "Amigos": tu código (`Josevi#4821`) para compartir, añadir por código, solicitudes recibidas (aceptar / rechazar), lista con estado (conectado / jugando / desconectado) y quitar amigo.
- Invitar a un amigo conectado **a tu pareja** (S3-04) o **a tu mesa privada** (S3-03). Le sale un aviso "Pilar te invita a jugar de pareja · [Unirme] [Ahora no]".
- En la pantalla de pareja, mientras esperas: "Invita a un amigo" con los que están conectados. Cierra el pendiente **"Jugar con Pilar otra vez"** del Sprint 3.
- Entrada desde la portada ("👥 Amigos", con el número de solicitudes pendientes).

**Hecho (2026-10-20)**
- Server: `src/friends.ts`. Listas en el doc de `users` (`friends`, `friendsIn`, `friendsOut`), sin contenedor nuevo. Búsqueda por código con `PlayerRepo.findByNameTag` (solo jugadores con cuenta). Si los dos se envían solicitud, quedan amigos. Máx. 200 amigos y 50 solicitudes pendientes.
- Presencia en memoria: cualquier petición `/api` con sesión cuenta como "visto"; conectado = último minuto; jugando = sentado en una mesa viva.
- Invitaciones en memoria (2 min, una viva por pareja de amigos), solo a tu pareja (con hueco) o a tu mesa privada (sin empezar y con hueco).
- Rutas: `GET /api/friends`, `POST /api/friends/request`, `POST /api/friends/:id/accept|reject`, `DELETE /api/friends/:id`, `POST /api/friends/:id/invite`, `POST /api/invites/:id/dismiss`. Límite: 30 escrituras/min por cuenta.
- Borrar la cuenta te quita de las listas de los demás.
- Web: pantalla `#amigos` (también `#amigos/Nombre%231234` para añadir con enlace), botón "👥 Amigos" con el número de solicitudes, aviso "Pilar te invita…" (se consulta cada 15 s con la pestaña visible; no sale durante una partida), y "Invita a un amigo conectado" en la pantalla de pareja y en la mesa privada.
- Tests: `tests/friends.test.ts` (11).

### S5-02 — Notificaciones (PWA) — ~1,5 d ✅
- Activar el service worker y Web Push (claves VAPID). Pedir permiso **solo** cuando tenga sentido (al añadir el primer amigo o al apuntarse a un torneo), nunca al entrar.
- Avisos: invitación de un amigo, solicitud de amistad, tu reto/torneo empieza.
- iPhone: solo funcionan si la web está añadida a la pantalla de inicio (iOS 16.4+): explicarlo en la pantalla de permisos.
- Ajustes: qué avisos quieres recibir.

**Hecho (2026-10-20)**
- Server: `src/push.ts` con `web-push` (claves VAPID). Contenedor nuevo `pushSubs` (PK `/userId`), una suscripción por dispositivo (máx. 10; las caducadas, 404/410, se borran solas). Preferencias por tipo en el doc del usuario (`pushPrefs`, por defecto todo sí).
- Rutas: `GET /api/push/config`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `GET|PUT /api/push/prefs`. Límite: 20 escrituras/min por cuenta. Sin claves VAPID, todo sigue funcionando sin push.
- Avisos: solicitud de amistad (siempre) e invitación a jugar (solo si no tienes la web abierta; caduca a los 2 min).
- Web: `public/sw.js` solo para avisos (no cachea nada; el server lo sirve con `no-cache`). Tarjeta "¿Te avisamos…?" en Amigos cuando ya tienes o has pedido algún amigo; en iPhone sin instalar, instrucciones para añadir a la pantalla de inicio. Sección "Avisos" en el perfil. Al cerrar sesión o borrar la cuenta se quita la suscripción del dispositivo.
- Iconos de la app (`icon-192/512`, maskable, `apple-touch-icon`, `badge-96`) y manifest completo.
- Privacidad: añadidos amigos y avisos.
- Tests: `tests/push.test.ts` (6). Service worker probado en Chromium (aviso con icono y destino correcto).

### S5-03 — Peñas — ~1,5 d ✅
- Crear una peña (nombre, pueblo) e invitar a amigos; unirse con enlace. Un creador que puede expulsar.
- Página de la peña: miembros, su ranking interno (temporada y semana) y "quién está conectado" para montar partida.
- Insignia de la peña junto a tu nombre (opcional). → Pospuesto: de momento la peña se ve en su página.

**Hecho (2026-10-20)**
- Decisión: **una peña por persona** (más claro para los retos de S5-04), máx. 50 miembros, nombre de 3 a 30 letras con filtro de palabras.
- Server: `src/penas.ts`. Contenedor nuevo `penas` (PK `/id`); en el doc del usuario `penaId` y `penaInvites`. Se entra con el enlace (`#pena-CODIGO`, 6 caracteres) o con la invitación de un amigo que ya está dentro (le llega aviso push). El creador puede expulsar; si se va, la peña pasa al miembro más antiguo; si no queda nadie, se borra. Al borrar la cuenta, se sale de la peña.
- Rutas: `GET /api/penas/mine`, `POST /api/penas`, `GET|POST /api/penas/join/:code`, `POST /api/penas/invites/:id/accept|decline`, `POST /api/penas/mine/invite|kick/:userId`, `POST /api/penas/mine/leave`. Límite: 20 escrituras/min por cuenta.
- Los de tu peña se pueden invitar a jugar (pareja / mesa privada) aunque no seáis amigos: salen en "Invita a un amigo conectado".
- Web: pantalla `#pena` (crear, invitaciones recibidas, tu peña con ranking de temporada y de la semana, quién está conectado o jugando, invitar amigos, expulsar, salir) y vista previa del enlace. Botón "🍻 Peña" en la portada con el número de invitaciones.
- Tests: `tests/penas.test.ts` (7).

### S5-04 — Retos entre peñas — ~1,5 d ✅
- Una peña reta a otra: N partidas (p. ej. 10) durante una semana; cuentan las partidas online entre miembros de las dos peñas.
- Marcador del reto en las dos páginas y aviso al empezar/terminar.

**Hecho (2026-10-21)**
- Reglas: quien lleva la peña reta a otra a **5, 10 o 20 partidas**; la otra tiene **3 días** para aceptar; después hay **7 días**. Cuenta cada partida (mano completa) en la que en una pareja solo hay gente con cuenta de una peña y en la otra solo de la otra; los huecos pueden ser bots y valen también las mesas privadas. Termina al jugar las N o al acabar el plazo; gana la que más partidas se lleve (o empate). Máx. 3 retos abiertos por peña y uno con cada peña.
- Server: `src/retos.ts`, contenedor nuevo `retos` (PK `/id`). `room.ts` avisa del fin de cada partida (`onPartidaEnd`) y se cuenta ahí. Barrido cada 10 min (y al arrancar) para cerrar retos vencidos. Búsqueda de peñas por nombre (sin tildes) con `nameKey`.
- Rutas: `GET /api/penas/search?q=`, `POST /api/penas/retos`, `POST /api/penas/retos/:id/accept|decline|cancel`; los retos van dentro de `GET /api/penas/mine`.
- Avisos push: os retan (a quien lleva la peña), empieza y termina (a todos los miembros). Nueva preferencia "Retos de tu peña".
- Web: sección "Retos" en la página de la peña (marcador con barra, pendientes con Aceptar/No o Cancelar, últimos resultados, "⚔️ Retar a otra peña" con buscador y 5/10/20).
- Tests: `tests/retos.test.ts` (4).

### S5-05 — Torneos — ~3 d ✅
- Torneos de parejas por eliminatorias: inscripción, cuadro, cruces a una hora fija (o "jugad cuando queráis antes del domingo"), resultado automático desde la partida, campeón con insignia.
- Empezar con torneos creados por el administrador; después, que una peña pueda montar el suyo. → Lo de las peñas queda para más adelante.

**Hecho (2026-10-21)**
- Admin = emails en `ADMIN_EMAILS`. Crea: nombre, 8 o 16 parejas, cruces a 1 partida o al mejor de 3, días por ronda (1, 2, 3 o 7) y fin de la inscripción.
- Inscripción: apuntas a un amigo como pareja y él confirma (aviso push). Cualquiera de los dos puede borrarse mientras esté abierta.
- Al cerrar la inscripción (barrido cada 10 min, o "Empezar ya" del admin): cuadro por nivel medio de la pareja con cabezas de serie y pases directos; si hay menos de 2 parejas, se cancela.
- Cada ronda tiene fecha límite. "Ir a la mesa" crea la mesa del cruce y reserva tu silla (pareja A en 0-2, B en 1-3). La mesa empieza sola con los cuatro, sin bots de relleno ni revancha, no cuenta para el nivel y no se puede entrar con el código. El resultado se apunta solo al terminar (`onMatchEnd` en `room.ts`).
- Plazo vencido sin jugar: pasa la pareja que se presentó (pulsó "Ir a la mesa"); si ninguna o las dos, sorteo. Si la mesa está en juego al vencer, se le deja acabar.
- Campeón: insignia en "Tus torneos" del perfil de los dos (`trophies` en `users`) y aviso a todos.
- Server: `src/torneos.ts`, contenedor nuevo `torneos` (PK `/id`), rutas `GET|POST /api/torneos`, `GET /api/torneos/:id`, `POST /api/torneos/:id/signup|confirm|withdraw|play|start|cancel`. Avisos push con su preferencia "Torneos".
- Web: botón "🎖️ Torneos" en la portada, lista, página del torneo (inscripción, tu cruce con "Ir a la mesa", cuadro por rondas, campeones, botones del admin) y sala de espera del cruce.
- Tests: `tests/torneos.test.ts` (9).

### Pendientes pequeños
- ✅ Quitar `POST /api/rooms/matchmake` (salas de espera antiguas). Hecho 2026-10-20: borrados el endpoint y `findOrCreateMatchmakeRoom`; "Jugar online" usa solo la cola `/ws/matchmake`.
- Application Insights en Azure (errores reales de móviles).
- ✅ Página "Cómo se juega" (`#reglas`, enlace en la portada): resumen, cartas con sus puntos, reparto y triunfo, bazas, arrastre, cantes y el siete, puntos (buenas/malas, vueltas, 10 de últimas), coto, trucos y glosario. Escrita según las reglas del motor (`GUINOTE_ARAGONES`). Hecho 2026-10-21.

**Total estimado: ~9 días.**

## Riesgos
- **Push en iPhone**: depende de que añadan la web a la pantalla de inicio; los avisos dentro de la app siguen siendo la vía principal.
- **Presencia en memoria**: con escala a 0 y una réplica es suficiente; con varias réplicas haría falta Redis.
- **Torneos y horarios**: si alguien no se presenta, regla clara (gana el rival a los 10 minutos).
