# Sprint 3 — Cuentas, mesas privadas y pareja fija

**Goal**: jugar con *tus* amigos. Que puedas entrar con tu cuenta desde cualquier dispositivo sin perder tu nivel, montar una mesa privada con quien quieras, ir a jugar online con tu pareja de siempre, y que el emparejamiento tenga en cuenta el nivel.

**Estado a fecha 2026-10-18**: planificado, sin empezar. Requisito previo: el juego desplegado en Azure (S2-16, a mano por el usuario).

---

## Dónde va el auth: al principio del Sprint 3

**Decisión propuesta: el auth es lo primero del Sprint 3 (S3-01), justo después del despliegue.** Razones:

1. **Todo lo que viene después necesita saber quién eres.** La pareja fija (S3), el ranking público, el historial y las divisiones (S4), las peñas, los retos y los torneos (S5) se apoyan en una identidad que dure. Con la cookie anónima de hoy, si cambias de móvil o borras datos eres otro jugador y pierdes tu nivel.
2. **Cuanto antes, menos ELO huérfano.** Cada partida jugada con identidad anónima es nivel que luego habrá que vincular a una cuenta. Con pocos jugadores aún, migrar es trivial; en S4, con ranking público, sería un problema.
3. **No antes del despliegue.** El login con Google necesita HTTPS y un dominio público (las URL de retorno de OAuth no aceptan `http://192.168.x.x`), y las cookies de sesión necesitan `Secure`. Por eso el orden es: desplegar → auth.
4. **No más tarde (S4).** El ranking público sin cuentas invita a abusos (multicuenta, borrar cookies para "resetear") y obliga a construir el ranking dos veces.

**Principio: jugar sin cuenta sigue siendo posible.** Entrar en 1-2 toques era la prioridad del Sprint 2 y no se pierde. La cuenta es opcional ("Guarda tu progreso") y, al crearla, el nivel que llevabas como invitado pasa a tu cuenta. Solo el ranking público (S4) exigirá cuenta para aparecer.

---

## Decisiones

| Eje | Decisión | Notas |
|---|---|---|
| Proveedor de login | **Solo Google** (confirmado 2026-10-19). Sin contraseñas. | El enlace por email (login sin contraseña para quien no use Google) queda descartado por ahora; se puede añadir después sin tocar lo demás. Apple, si algún día hay app en la App Store. |
| Sesión | Cookie httpOnly firmada (como la de hoy) con el `userId`; el WS la lee en el handshake. | JWT en `localStorage` (peor: accesible desde JS). |
| Nombre visible | Nombre libre, no único; para el ranking (S4) se añade un identificador corto (`Jose#4821`). | Nombres únicos (fricción al registrarse). |
| Invitado → cuenta | Al iniciar sesión, el `playerId` anónimo se vincula a la cuenta (rating, partidas). Si ya tenías cuenta, gana la cuenta. | Empezar de cero al crear la cuenta. |

---

## Tareas, en orden

### S3-00 — Despliegue en Azure (S2-16) — ✅ cerrado (2026-10-19, usuario)
- Requisito del resto. Notas en `SPRINT2.md` S2-16.
- Recomendado añadir **Application Insights** al desplegar (errores y desconexiones reales de móviles).

### S3-01 — Cuentas: login opcional con Google — ~2 d
- Botón "Entrar / Guardar mi progreso" en la portada; quien no entra sigue jugando como invitado.
- Contenedor `users` en Cosmos (`/userId`): nombre, proveedor, `linkedPlayerIds`, fecha de alta.
- Vincular el `playerId` anónimo (cookie `guinote_pid`) a la cuenta y fusionar rating/partidas.
- Sesión: cookie firmada; el WS identifica al usuario en el handshake (hoy usa `?pid` / cookie anónima).
- Cerrar sesión y borrar cuenta (RGPD: el usuario puede pedir sus datos y borrarlos).
- Tests: vincular invitado, fusión de rating, sesión caducada, WS con y sin cuenta.

### S3-02 — Perfil mínimo — ~0,5 d
- Pantalla "Mi perfil" con el estilo de la portada: nombre, partidas jugadas y ganadas.
- **Sin ELO visible todavía** (llega en S4 con el ranking).

### S3-03 — Mesas privadas — ✅ cerrado (2026-10-19)
- "Crear mesa privada": código + enlace para compartir (como el lobby actual, pero **sin** cuenta atrás ni bots automáticos).
- El anfitrión ve la mesa (como la pantalla de espera nueva), puede **mover jugadores de asiento** (elegir parejas), **completar con bots** (con nivel) y **empezar** cuando quiera.
- No entran en el matchmaking ni cuentan para ELO (partidas entre amigos).
- Hecho: `POST /api/rooms` con `mode: 'private'` (`room.isPrivate`, `room.hostSeat`). Sin cuenta atrás ni relleno automático; mensajes `PRIVATE_SWAP_SEATS` y `PRIVATE_START { botLevel }` solo para el anfitrión. Si el anfitrión se va, pasa al siguiente humano. Abandonar no penaliza ELO. Portada: sección "Con amigos" (crear mesa / entrar con código). Sala de espera: tocar dos asientos para cambiarlos, nivel de bots y "Empezar partida". Tests en `private.test.ts`.

### S3-04 — Pareja fija — ~1,5 d
- Invitar a un amigo a ser tu pareja ("grupo de 2") y pulsar "Jugar online" juntos: el emparejamiento os sienta enfrente (compañeros) contra otra pareja o contra 2 sueltos.
- En mesas privadas, el anfitrión puede fijar las parejas.
- Con cuenta, la pareja se recuerda ("Jugar con Pilar otra vez").

### S3-05 — Matchmaking por nivel (antes S2-11) — ~1 d
- Conectar "Jugar online" a la cola por rating que ya existe en el server (`matchmaking.ts`), con pantalla "Buscando partida" al estilo de la sala de espera.
- La cola admite **grupos de 2** (pareja fija) además de jugadores sueltos.
- Bots de relleno con nivel según el rating medio de la mesa (nivel 1 / 2 de S2-10).
- Si en X segundos no hay rivales humanos, completar con bots (como hoy).

### Reglas de coto y match (confirmadas 2026-10-19)
- **Coto**: lo gana quien gana **3 partidas**.
- **Match**: lo gana quien gana **2 cotos** (al mejor de 3). Solo en mesas privadas y futuros torneos, **no en partidas rápidas**.
- Varía según el lugar → los números son **configurables** en las mesas privadas (partidas por coto, cotos por match).
- Entre partidas (y entre cotos de un match) se sigue **directamente, sin votación**. La **revancha se pregunta al final**: al acabar el coto (partida rápida o privada de 1 coto) o al acabar el match.

### S3-06 — Partida rápida = 1 coto, revancha al final — ✅ cerrado (2026-10-19)
- **Cambia el comportamiento de S2-13**: hoy se vota revancha tras CADA partida y el coto se corta si alguien dice que no. Con la regla confirmada, las partidas del coto se encadenan solas (como las manos de una partida) y la votación aparece **solo al acabar el coto**. Si todos aceptan, empieza un coto nuevo desde 0–0 en la misma mesa; si no, la mesa se cierra.
- Abandonar a mitad de coto sigue siendo derrota de ELO (S2-12); el ELO se sigue calculando por partida.
- Ajustar los textos: "Coto ganado / perdido 3 – 1" en el panel final.
- Hecho: `triggerNextHand` (`room.ts`) encadena las partidas y solo abre la votación al llegar a 3; revancha aceptada → `matchWins` a 0-0 y coto nuevo. Panel: "Partida para nosotros · Partidas 2 – 1 · el coto es a 3" + "Siguiente partida en unos segundos…" entre partidas; "Coto terminado · ¿Otro coto?" al final. Tests de `rematch`, `substitute` y `snapshot` adaptados (125 en verde en todo el monorepo).

### S3-07 — Coto y match en mesas privadas — ✅ cerrado (2026-10-19)
- Otra implementación de `MatchScoring` (S2-06), p. ej. `cotos({ partidasPorCoto: 3, cotosParaGanar: 2 })`, con marcador de partidas del coto en curso y de cotos ganados.
- Al crear la mesa privada, el anfitrión elige: **1 coto** (por defecto) o **match a 2 cotos**, y puede cambiar partidas por coto / cotos por match.
- Cabecera de la mesa con match: "Partidas 2 – 1 · Cotos 1 – 0".
- Hecho: `MatchFormat { partidasPorCoto, cotosParaGanar }` en el motor (`QUICK_FORMAT` 3/1, `COTO_MATCH_FORMAT` 3/2, límites 1–5 y 1–3) con `recordPartidaResult` y `progressLeader`. El server lleva `room.format` y `room.cotoWins`; entre cotos se sigue sin votar y la revancha solo al acabar el match. `PRIVATE_START` acepta `partidasPorCoto` y `cotosParaGanar`; el snapshot guarda formato y cotos. Sala de espera con dos selectores (+/–). Cabecera en dos líneas en móvil. 141 tests en verde.

### S3-08 — Pulido de producto — ✅ cerrado (2026-10-19)
- Sonidos opcionales (carta jugada, cante, tu turno) con botón de silencio.
- Selector de nivel de bots en "Practicar contra bots" (ya soportado por el server, falta la UI).
- Hecho: `apps/web/src/sounds.ts` sintetiza los sonidos con Web Audio (sin ficheros): carta jugada, cante y tu turno. Botón de silencio (icono de altavoz) en la cabecera de la mesa, guardado en `localStorage` (`guinote:muted`). La primera VIEW al entrar o reconectar no suena. Portada: "Practicar contra bots" con dos botones, Fácil (nivel 1) y Normal (nivel 2); cada uno empieza la partida. La cabecera se ajusta para no desbordar en 360 px.

**Total estimado: ~8,5 días** (sin contar el despliegue).

Dependencias: `S3-00 → S3-01 → (S3-02, S3-04)`; `S3-03` puede ir en paralelo a S3-01; `S3-04 → S3-05`; `S3-06` independiente (se puede hacer ya, no necesita despliegue); `S3-07` después de S3-03 y S3-06.

---

## Sprints siguientes (replanificados)

### Sprint 4 — Ranking (requiere cuentas)
- ELO visible en el perfil y en la mesa.
- `ratingHistory` por match (pendiente de S2-17): historial de partidas y rachas.
- Ranking individual y **ranking de parejas** (aprovecha la pareja fija de S3).
- Clasificación semanal, divisiones (Bronce / Plata / Oro / Maestro / Leyenda) y temporadas con reinicio parcial y cosméticos.
- Penalización por abandonos reiterados (más allá de la derrota de ELO de hoy).
- Antiabuso básico: límites por IP / cuenta, detección de multicuenta en el ranking.

### Sprint 5 — Pique social
- Peñas / pueblos (grupos con su propio ranking), retos entre peñas, enfrentamientos directos y torneos.
- Notificaciones push (PWA) para retos y "te toca".

---

## Decisiones de la lista del Sprint 2

| Tema | Decisión |
|---|---|
| Matchmaking con rating | **S3-05**, junto con la pareja fija. |
| Cuentas reales | **S3-01**, primera tarea tras el despliegue (ver arriba). Solo Google. |
| Partidas privadas con coto | **S3-03 + S3-07**. Partida rápida = 1 coto con revancha al final (**S3-06**). |
| App nativa | **No por ahora.** La PWA cubre el uso en móvil. Revisar tras S5 si hace falta estar en las tiendas (Capacitor reutiliza el mismo código). |
| i18n es/en | **Aplazado sin fecha.** El público es aragonés/español; se retoma si hay interés fuera. |
| Ranking y ELO visibles | **Sprint 4**, ya con cuentas. |

---

## Riesgos

- **OAuth y dominio**: el login necesita el dominio definitivo del despliegue; cambiarlo luego obliga a reconfigurar las URL de retorno.
- **Fusión invitado → cuenta**: si un invitado juega en dos dispositivos antes de crear la cuenta, solo se fusiona el del dispositivo donde inicia sesión (aceptable; documentarlo).
- **Varias réplicas**: las salas viven en memoria de una sola réplica (`min = max = 1`). Con cuentas y más jugadores, escalar exigirá Redis o similar (fuera de este sprint).
- **RGPD**: con cuentas guardamos datos personales (email): política de privacidad y borrado de cuenta obligatorios antes de abrir al público.
