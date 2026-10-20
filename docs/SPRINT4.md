# Sprint 4 — Ranking

**Goal**: que tu nivel se vea y signifique algo. Historial de tus partidas, tu división (Bronce → Leyenda), y rankings en los que compararte: en España, en tu provincia y en tu pueblo, solo y en pareja.

**Estado a fecha 2026-10-20**: planificado, sin empezar. Sprint 3 cerrado (cuentas, perfil, mesas privadas, pareja fija, cola por nivel).

---

## Decisiones (confirmadas 2026-10-20)

| Eje | Decisión | Notas |
|---|---|---|
| Quién sale en el ranking | **Solo jugadores con cuenta** y un mínimo de partidas (10). | Los invitados juegan y tienen ELO, pero no salen en la tabla: evita duplicados y "resetear" borrando cookies. |
| Cómo se ve el nivel | **Divisiones** (Bronce, Plata, Oro, Maestro, Leyenda) y el ELO en pequeño en tu perfil. | Más fácil de entender que un número. |
| Orden | **Ranking global primero**: historial → nivel visible → de dónde eres → ranking individual → parejas. Después semanal, abandonos, antiabuso y temporadas. | |
| Pueblo y provincia | **En este sprint**, como filtros del mismo ranking: cada jugador dice en su perfil de dónde es. | Las **peñas** (grupos con miembros, retos entre peñas) siguen en el Sprint 5. |

## Por decidir (antes de la tarea que lo necesita)

- Nada por ahora.

---

## Tareas, en orden

### S4-00 — Privacidad (RGPD) — ✅ cerrado (2026-10-20)
- Requisito antes de abrir al público: con cuentas guardamos email y nombre.
- Página "Privacidad" en lenguaje llano: qué guardamos (nombre, email, partidas, nivel), para qué, cuánto tiempo, cómo descargarlo y borrarlo (ya existe en "Mi perfil").
- Enlace desde la portada, la bienvenida y el perfil.
- Solo usamos cookies técnicas (sesión e identidad de juego): basta con informar, sin banner de consentimiento.
- Hecho: `pages/Privacy.tsx` en `#privacidad` (responsable: Jose Vicente López Díaz, josev.lopez.diaz@gmail.com). Enlaces en la portada (abajo), la bienvenida y "Mi perfil".

### S4-01 — Historial de partidas — ✅ cerrado (2026-10-20)
- Un documento por jugador y partida en un contenedor nuevo `results` (PK `/playerId`): fecha, ganada/perdida, compañero, rivales, ELO antes/después, tipo (online, pareja).
- "Mi perfil": últimas 20 partidas, racha actual y mejor racha.
- Base para el ranking semanal (S4-06) y el de parejas (S4-05).
- Hecho:
  - `apps/server/src/results.ts`: un registro por jugador y partida con ELO (fin de partida y abandonos), en el contenedor `results` (PK `/playerId`). Mejor esfuerzo: si falla, el ELO y la partida siguen.
  - Rachas en el documento del jugador: `streak` (+ ganadas / − perdidas seguidas) y `bestStreak`.
  - `GET /api/me/results`: tus 20 últimas, juntando la cuenta y los dispositivos fusionados. El historial va en "Descargar mis datos" y se borra con la cuenta.
  - "Mi perfil": "🔥 Llevas 3 ganadas seguidas", mejor racha y lista de últimas partidas (ganada/perdida/abandono, compañero, rivales, puntos ±, cuándo).
  - Las partidas anteriores a este cambio no aparecen (no se guardaban).
  - 8 tests nuevos (`results.test.ts` y uno en `auth.test.ts`); 185 en total.

### S4-02 — Nivel visible: divisiones — ✅ cerrado (2026-10-20)
- Insignia de división en el perfil (con el ELO en pequeño) y junto al avatar en la mesa para jugadores con cuenta.
- "Sin clasificar" hasta 10 partidas. Los bots no llevan insignia.
- Al subir o bajar de división, aviso al acabar la partida.
- Hecho:
  - Cortes confirmados en `packages/protocol/src/divisions.ts` (compartido servidor/web): Bronce < 900 · Plata 900–1049 · Oro 1050–1199 · Maestro 1200–1349 · Leyenda ≥ 1350; sin clasificar hasta 10 partidas.
  - Servidor: al sentarse un jugador se lee su división (solo con cuenta) y va en `SEATS.seatDivisions`; al acabar una partida se actualiza y, si cambia, `DIVISION_CHANGED` a ese jugador.
  - Mesa: escudo del color de la división abajo a la izquierda del avatar. Aviso "¡Subes a Oro!" / "Bajas a Plata" / "¡Ya tienes división!" (se cierra solo a los 7 s).
  - Perfil: tarjeta con la división, los puntos y la barra "Te faltan 77 para Maestro"; sin clasificar, "Juega N partidas online más".

### S4-03 — De dónde eres — ✅ cerrado (2026-10-20)
- En "Mi perfil": provincia (lista de las 52) y municipio (lista oficial del INE, con autocompletado para no tener "Zaragoza", "zaragoza" y "Zgz").
- Se puede cambiar como mucho una vez cada 30 días (que nadie salte de pueblo en pueblo para salir primero).
- Opcional: no ponerlo = solo sales en el ranking de España.
- Hecho:
  - Datos: `apps/server/data/municipios.json` con los **8.132 municipios del INE** (código de 5 cifras y nombre; para los bilingües, también el otro nombre, p. ej. "Sagunt · Sagunto/Sagunt"). Generado del paquete `spanish-cities-info` (licencia ISC) y contrastado con `@doncicuto/es-municipalities`: coinciden código a código; el primero añade Usansolo (2022). El juego no depende de esos paquetes, solo del JSON.
  - Provincias (52) en `packages/protocol/src/places.ts`, compartidas.
  - Se guarda en el jugador principal: `place { province, municipio }` y `placeChangedAt`. La primera vez es libre; después, un cambio cada 30 días (volver a guardar lo mismo no cuenta).
  - Endpoints: `GET /api/places/:prov` (municipios de una provincia, con caché de un día) y `PUT /api/me/place`. `/api/me` devuelve `place` con nombres y `nextChangeAt`.
  - "Mi perfil" → "De dónde eres": provincia en lista, pueblo con buscador (sin acentos, por el principio o por dentro del nombre), "Prefiero no decirlo" y aviso de la fecha en que se podrá volver a cambiar.
  - 7 tests nuevos (`places.test.ts` y uno en `auth.test.ts`); 196 en total.

### S4-04 — Ranking individual — ✅ cerrado (2026-10-20)
- Pantalla "Ranking" con pestañas: **España · Mi provincia · Mi pueblo**.
- Top 100 + tu puesto aunque no estés en el top.
- Requisitos: cuenta, ≥ 10 partidas y haber jugado en los últimos 30 días.
- En el servidor: consulta ordenada por ELO con caché de 1 minuto (pocas lecturas a Cosmos).
- Hecho:
  - **Nombre público**: el nombre en la mesa se guarda en la cuenta (`PUT /api/me/name`) con una etiqueta de 4 cifras fija (`Josevi#4821`). Se sincroniza al cambiar el nombre en la portada y, si la cuenta aún no tenía, al entrar. En un dispositivo nuevo, la portada coge el nombre de la cuenta. "Mi perfil" muestra ese nombre con su etiqueta.
  - **Última partida** (`lastPlayedAt`) en el jugador, para el requisito de 30 días. Los jugadores existentes aparecen tras su próxima partida con ELO.
  - `apps/server/src/ranking.ts`: quién sale (cuenta, ≥ 10 partidas, activo en 30 días; ni invitados ni dispositivos fusionados), top 100 por ámbito con caché de 1 minuto y tu puesto con un COUNT. `GET /api/ranking?scope=es|prov|mun`.
  - Pantalla `#ranking`: pestañas España / tu provincia / tu pueblo, tu puesto arriba (o por qué no sales: sin cuenta, te faltan N partidas, 30 días sin jugar), medallas a los 3 primeros, escudo de división, puntos y "(tú)". Sin pueblo elegido → enlace a "Mi perfil". Aviso si en tu pueblo sois menos de 5.
  - Acceso: botón "🏆 Ver el ranking" en la portada y en "Mi perfil". Los invitados pueden ver el de España.
  - 7 tests nuevos (`ranking.test.ts` y uno en `auth.test.ts`); 203 en total.
  - Pendiente (S4-08): filtro de nombres ofensivos y que dos jugadores no tengan el mismo nombre y etiqueta (hoy es muy improbable, no imposible).

### S4-05 — Ranking de parejas — ✅ cerrado (2026-10-20)
- ELO propio de cada pareja (dos cuentas), que solo se mueve cuando juegan juntos como pareja fija (S3-04).
- Pestaña "Parejas" en el ranking, con los mismos filtros.
- Hecho:
  - `apps/server/src/pairs.ts`: contenedor `pairs` (PK `/id`, id = los dos playerId ordenados). Una pareja = dos jugadores **con cuenta** sentados juntos como pareja fija (mismo `partyCode` de S3-04). Empieza en 1000; al acabar cada partida con ELO se actualiza contra la otra pareja (su nivel de pareja) o contra la media de los dos sueltos.
  - El sitio de la pareja (provincia/pueblo) solo cuenta si los dos son del mismo.
  - Ranking: ≥ 5 partidas juntos y alguna en los últimos 30 días. `GET /api/ranking?period=parejas` → `period=pairs`, con España / provincia / pueblo y caché de 1 minuto. Tu mejor pareja y su puesto, o por qué no sale (sin pareja, faltan N partidas, no sois los dos de aquí).
  - Pantalla: "General | Esta semana | Parejas", "Josevi & Pilar".
  - RGPD: tus parejas van en "Descargar mis datos" y se borran con la cuenta.

### S4-06 — Clasificación semanal — ✅ cerrado (2026-10-20)
- Tabla que se reinicia cada lunes: puntos de la semana (por ejemplo, ELO ganado en la semana). Da motivo para volver aunque seas nuevo.
- Hecho:
  - Puntos de la semana = **puntos de nivel ganados (o perdidos) desde el lunes**. Semana de lunes 00:00 a domingo 23:59 en hora de España (`packages/protocol/src/week.ts`, ISO `2026-W43`; probado con el cambio de hora y el fin de año).
  - En el jugador: `weekId`, `weekPoints`, `weekGames`; se actualizan al acabar cada partida con ELO (y en los abandonos) y se ponen a cero solos al cambiar de semana.
  - Para salir: cuenta y **3 partidas online esa semana** (no hace falta estar clasificado: un recién llegado puede ir primero).
  - `GET /api/ranking?period=week` con los mismos ámbitos (España / provincia / pueblo) y caché.
  - Pantalla de ranking: "General | Esta semana"; puntos con signo (+45, −20) y tu puesto "2º · +28 esta semana".

### S4-07 — Abandonos reiterados — ✅ cerrado (2026-10-20)
- Hoy abandonar ya cuenta como derrota de ELO. Además: 3 abandonos en 24 h → 5 minutos sin poder buscar partida, con aviso claro.
- Hecho:
  - `apps/server/src/abandons.ts`: cada abandono que cuenta (a mitad de partida, con rivales humanos, no en privadas) se apunta en el jugador (`abandons`, últimas 24 h). Al tercero, `queueBanUntil` = ahora + 5 min.
  - Cola: mensaje `QUEUE_BLOCKED` y la portada dice "Has abandonado 3 partidas en las últimas 24 horas. Podrás buscar partida online a partir de las 16:05. Mientras, puedes practicar contra bots o jugar en una mesa privada." La pareja tampoco puede buscar si uno de los dos está castigado.
  - Aviso antes: "Salir" a mitad de partida con rivales humanos (no privada) pide confirmación: "Si sales ahora, cuenta como partida perdida… Si abandonas 3 partidas en 24 horas, no podrás buscar partida online durante 5 minutos." [Seguir jugando] [Salir igualmente].
- Tests (S4-05 + S4-07): 8 nuevos; 227 en total.

### S4-08 — Antiabuso básico — ✅ cerrado (2026-10-20)
- Límites de peticiones por IP y por cuenta.
- Señales de multicuenta en el ranking (misma IP/dispositivo jugando siempre juntos en equipos contrarios) → revisar, no castigar automáticamente.
- Hecho (adelantada a S4-05/06/07 a petición del usuario):
  - **Límites de peticiones** (`apps/server/src/ratelimit.ts`, en memoria, sin dependencias): login 10/min por IP, escrituras de cuenta 20/min por cuenta, crear mesa/pareja 30/min por IP, ranking 60/min, abrir WebSocket 60/min, y 600/min por IP para todo `/api` (cabe de sobra preguntar por la pareja cada segundo con varios en la misma wifi). Responde 429 con `Retry-After`. Fastify con `trustProxy` para leer la IP real detrás del proxy de Azure.
  - **Nombres ofensivos** (`packages/protocol/src/names.ts`, compartido): normaliza acentos, números por letras (`P0LLA`), separadores (`p.u.t.a`) y letras repetidas; palabras largas en cualquier parte, cortas solo como palabra entera (no bloquea Pola, Pollo, Apolonia, Penélope, Mariquita, Scunthorpe…). La web avisa al escribirlo; el servidor rechaza el nombre público y cambia por "Jugador" cualquier nombre que vean otros (mesa, cola, pareja).
  - **Nombre#etiqueta único**: si otro ya es "Pilar#1234", te toca otra etiqueta.
  - **Posible multicuenta**: huella anónima de la conexión de cada asiento (HMAC de la IP con sal aleatoria del proceso; la IP no se guarda). Si dos **rivales** comparten conexión, la partida queda marcada (`flag: 'misma_conexion'` en el historial y log `[antiabuso]`) para revisar; el ELO se aplica igual (puede ser una familia en casa). Compañeros en la misma conexión no se marcan.
  - Privacidad actualizada con la huella anónima.
  - 10 tests nuevos (`antiabuse.test.ts` y otros); 213 en total. Probado con el servidor real: el juego normal no se ve afectado y el login 11 en un minuto da 429.
  - Para revisar marcas en Cosmos: `SELECT * FROM c WHERE c.flag = 'misma_conexion'` en `results`.

### S4-09 — Temporadas — ✅ cerrado (2026-10-20)
- Temporadas de 3 meses, reinicio parcial del ELO hacia la media y una insignia cosmética por la división alcanzada.
- Hecho:
  - `packages/protocol/src/seasons.ts`: trimestres en hora de España (Invierno ene–mar, Primavera abr–jun, Verano jul–sep, Otoño oct–dic; id `2026-T4`).
  - Cambio de temporada **perezoso** (sin tareas programadas): la primera vez que el jugador entra (`/api/me`) o juega en la temporada nueva, recibe una **insignia con la división de su mejor nivel** de la temporada pasada (si estaba clasificado) y su nivel pasa **a medio camino de 1000** (1300 → 1150, 800 → 900). Jugadores anteriores sin temporada: se les apunta la actual sin reinicio. El reinicio se aplica antes de calcular la partida y también al nivel de la cola y a la división de la mesa.
  - Campos en el jugador: `seasonId`, `seasonPeak`, `seasonBadges`.
  - El ranking general pasa a ser **de la temporada**: hay que haber jugado en ella. El semanal y el de parejas no cambian.
  - Perfil: "Temporada Otoño 2026 · termina el 31 de diciembre" y "Tus temporadas" con las insignias. Ranking: pestaña "Temporada" con la explicación.
  - Tests: 7 nuevos; **234 en total**.

---

## Estado al cierre (2026-10-20)

Sprint 4 completo: S4-00 a S4-10. Para desplegar:
1. `npm install` y `npm run build` (cambian protocolo, servidor y web).
2. Contenedores Cosmos nuevos: `results` (PK `/playerId`) y `pairs` (PK `/id`).
3. Pendiente de sprints anteriores: "Jugar con Pilar otra vez" (Sprint 5, con amigos), quitar `POST /api/rooms/matchmake`, Application Insights.

### S4-10 — Recordatorio de cuenta — ✅ cerrado (2026-10-20)
- A los invitados, al acabar su 5.ª partida: "Llevas 5 partidas, ¿las guardamos?" (una sola vez).
- Hecho: el navegador cuenta las partidas terminadas (cualquier modo, una vez por partida aunque reconectes). Con 5 o más, al volver a la portada sale la misma ventana de la bienvenida con otro texto: "Llevas 5 partidas. ¿Las guardamos? Ahora se guardan solo en este navegador…" y "Ahora no, seguir como invitado". Una sola vez; no sale si ya tienes sesión.
- Tests: 6 nuevos entre `week.test.ts`, `ranking.test.ts`, `results.test.ts` y `auth.test.ts`; 219 en total.

**Total estimado: ~9,5–10 días.**

---

## Pendiente de sprints anteriores

- **"Jugar con Pilar otra vez"** (S3-04): necesita amigos y saber quién está conectado → Sprint 5, con lo social.
- `POST /api/rooms/matchmake` (lobby antiguo): quitarlo cuando ya nadie use la web vieja.
- Application Insights en Azure (errores y desconexiones reales de móviles).

## Riesgos

- **Pocos jugadores**: un ranking por pueblo con 3 personas luce poco. Mostrar el de pueblo solo si hay al menos 5 clasificados; si no, invitar a jugar.
- **Coste de Cosmos**: las consultas ordenadas del ranking cruzan particiones; con caché de 1 minuto y top 100 el coste es bajo.
- **Privacidad**: el ranking hace públicos nombre y pueblo. Por eso el nombre público lo eliges tú y el pueblo es opcional.
