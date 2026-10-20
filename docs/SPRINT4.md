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

- **S4-04** (confirmado): nombre público = tu **nombre en la mesa** + etiqueta corta (`Jose#4821`), nunca el nombre de Google. Hay que guardar el nombre en la mesa en la cuenta (hoy solo vive en el navegador) y usarlo también en el título de "Mi perfil".

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

### S4-04 — Ranking individual — ~1,5 d
- Pantalla "Ranking" con pestañas: **España · Mi provincia · Mi pueblo**.
- Top 100 + tu puesto aunque no estés en el top.
- Requisitos: cuenta, ≥ 10 partidas y haber jugado en los últimos 30 días.
- En el servidor: consulta ordenada por ELO con caché de 1 minuto (pocas lecturas a Cosmos).

### S4-05 — Ranking de parejas — ~1,5 d
- ELO propio de cada pareja (dos cuentas), que solo se mueve cuando juegan juntos como pareja fija (S3-04).
- Pestaña "Parejas" en el ranking, con los mismos filtros.

### S4-06 — Clasificación semanal — ~1 d
- Tabla que se reinicia cada lunes: puntos de la semana (por ejemplo, ELO ganado en la semana). Da motivo para volver aunque seas nuevo.

### S4-07 — Abandonos reiterados — ~0,5 d
- Hoy abandonar ya cuenta como derrota de ELO. Además: 3 abandonos en 24 h → 5 minutos sin poder buscar partida, con aviso claro.

### S4-08 — Antiabuso básico — ~1 d
- Límites de peticiones por IP y por cuenta.
- Señales de multicuenta en el ranking (misma IP/dispositivo jugando siempre juntos en equipos contrarios) → revisar, no castigar automáticamente.

### S4-09 — Temporadas — ~1 d (si da tiempo)
- Temporadas de 3 meses, reinicio parcial del ELO hacia la media y una insignia cosmética por la división alcanzada.

### S4-10 — Recordatorio de cuenta — ~0,25 d
- A los invitados, al acabar su 5.ª partida: "Llevas 5 partidas, ¿las guardamos?" (una sola vez).

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
