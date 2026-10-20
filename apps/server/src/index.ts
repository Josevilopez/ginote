import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientMessageSchema, type ServerMessage } from '@guinote/protocol';
import type { Seat } from '@guinote/engine';
import { botThinkDelayMs } from '@guinote/bots';
import { createRoomWithBots, findOrCreateMatchmakeRoom, getRoom, setRoomStore } from './rooms.js';
import { loadSeatDivision, HEARTBEAT_MS, startPrivate, swapPrivateSeats, abandonDuringPostgame, markDisconnected, resumeRestoredRoom, applyActionWithResolveEvent, broadcastLobbyStatus, broadcastSeats, substituteWithBot, castRematchVote, clearAutoPlayTimer, clearLobbyTimer, emitAfterChange, scheduleAutoPlay, scheduleLobbyCheck, sendPostgameStateTo, stepBots, triggerNextHand } from './room.js';
import { MemoryRoomStore } from './persistence/memory.js';
import { persistRoom, setSnapshotSink } from './persistHooks.js';
import { isRoomSnapshot, roomFromSnapshot, serializeRoom } from './snapshot.js';
import { CosmosRoomStore } from './persistence/cosmos.js';
import { initCosmos, readCosmosConfig } from './persistence/cosmosClient.js';
import { getCosmosHandles, setCosmosHandles } from './globalHandles.js';
import {
  ensurePlayer,
  setPlayerCookie,
} from './players.js';
import { registerAuthRoutes, resolvePlayerId } from './auth/routes.js';
import { initSessionSecret } from './auth/session.js';
import { cancelPartySearch, createParty, dropStaleSearches, getParty, joinParty, leaveParty, playParty, renameMember, viewParty } from './parties.js';
import { BOT_FILL_AFTER_MS, dequeue as qDequeue, enqueue as qEnqueue, formTables, isInQueue, listQueue, playersSearching } from './matchmaking.js';
import { startQueuedTable } from './queueRoom.js';

type WsSocket = {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  readyState: number;
};

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);
// S3-01: cuentas con Google (opcional). Sin GOOGLE_CLIENT_ID el login
// queda desactivado y todo sigue funcionando como invitado.
const sessionsOk = initSessionSecret(process.env, (m) => app.log.warn(m));
await registerAuthRoutes(app, sessionsOk ? {} : { googleClientId: null });

/**
 * Detecta si el request viene por HTTPS. Tiene en cuenta el header
 * `X-Forwarded-Proto` que ponen los proxies reversos (Caddy, ACA).
 */
function isHttps(req: import('fastify').FastifyRequest): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return proto === 'https';
}

/** S3-05: ELO de un jugador (1000 si no hay Cosmos, ni doc, ni playerId). */
async function readRating(playerId: string | null): Promise<number> {
  const cosmos = getCosmosHandles();
  if (!cosmos || !playerId) return 1000;
  try {
    const { resource } = await cosmos.players.item(playerId, playerId).read();
    const r = (resource as { rating?: unknown } | undefined)?.rating;
    return typeof r === 'number' ? r : 1000;
  } catch {
    return 1000;
  }
}

app.post('/api/rooms', async (req, reply) => {
  const body = (req.body ?? {}) as { name?: string; mode?: 'lobby' | 'bots' | 'private' };
  const name = (body.name ?? 'Jugador').slice(0, 20);
  // `mode: 'bots'`  → mesa con bots ya listos, reparte al instante.
  // `mode: 'lobby'` (defecto) → sala en lobby: el humano espera 30 s a
  // que se le una un amigo antes de repartir (si nadie entra, los huecos
  // se rellenan con bots al expirar la ventana).
  // `mode: 'private'` (S3-03) → mesa privada: lobby sin cuenta atrás, empieza el anfitrión.
  const mode: 'lobby' | 'bots' | 'private' =
    body.mode === 'bots' ? 'bots' : body.mode === 'private' ? 'private' : 'lobby';

  // Identidad anónima: si Cosmos está activo, leemos/creamos player.
  // Si no, devolvemos un playerId en memoria (sin cookie ni persistencia).
  let playerId: string;
  const cosmos = (await import('./globalHandles.js')).getCosmosHandles();
  if (cosmos) {
    const existing = resolvePlayerId(req); // S3-01: con sesión, el player de la cuenta
    const { playerId: id } = await ensurePlayer(cosmos, existing);
    playerId = id;
    if (!existing) setPlayerCookie(reply, playerId, isHttps(req));
  } else {
    playerId = globalThis.crypto.randomUUID();
  }

  const room = createRoomWithBots({ fillWithBots: mode === 'bots' });
  if (mode === 'private') room.isPrivate = true;
  // S2-10: nivel de los bots (opcional; por defecto 2). S3-08: lo elige la portada al practicar.
  const bodyLevel = (req.body as { botLevel?: unknown } | undefined)?.botLevel;
  if (bodyLevel === 1 || bodyLevel === 2) room.botLevel = bodyLevel;
  return { code: room.code, mode, name, playerId };
});

// "Jugar con jugadores": asignación a la mejor sala abierta a matchmaking
// (la que tenga más humanos sin llegar a 4 y aún en lobby). Si no hay
// ninguna, crea una nueva en modo lobby. La sala creada no se rellena
// con bots al instante — el lobbyTimer del server se ocupa al expirar.
app.post('/api/rooms/matchmake', async (req, reply) => {
  const body = (req.body ?? {}) as { name?: string };
  const name = (body.name ?? 'Jugador').slice(0, 20);

  let playerId: string;
  const cosmos = (await import('./globalHandles.js')).getCosmosHandles();
  if (cosmos) {
    const existing = resolvePlayerId(req); // S3-01: con sesión, el player de la cuenta
    const { playerId: id } = await ensurePlayer(cosmos, existing);
    playerId = id;
    if (!existing) setPlayerCookie(reply, playerId, isHttps(req));
  } else {
    playerId = globalThis.crypto.randomUUID();
  }

  const { room, created } = findOrCreateMatchmakeRoom();
  return { code: room.code, name, created, playerId };
});

app.get('/api/health', async () => ({ ok: true }));

// ───────────── S3-04: pareja fija ─────────────
// El cliente guarda `memberId` (secreto de su plaza en el grupo) y
// pregunta el estado cada segundo mientras está en la pantalla de pareja.
app.post('/api/parties', async (req) => {
  const { party, memberId } = createParty((req.body as { name?: unknown } | undefined)?.name, Date.now(), resolvePlayerId(req));
  return { code: party.code, memberId, view: viewParty(party, memberId) };
});

app.post<{ Params: { code: string } }>('/api/parties/:code/join', async (req, reply) => {
  const r = joinParty(req.params.code, (req.body as { name?: unknown } | undefined)?.name, Date.now(), resolvePlayerId(req));
  if (!r.ok) {
    return r.error === 'full'
      ? reply.code(409).send({ error: 'Esta pareja ya está completa' })
      : reply.code(404).send({ error: 'Esa pareja ya no existe' });
  }
  const party = getParty(req.params.code)!;
  return { code: party.code, memberId: r.memberId, view: viewParty(party, r.memberId) };
});

app.get<{ Params: { code: string }; Querystring: { member?: string } }>('/api/parties/:code', async (req, reply) => {
  const party = getParty(req.params.code);
  const view = party && req.query.member ? viewParty(party, req.query.member) : null;
  if (!view) return reply.code(404).send({ error: 'Esa pareja ya no existe' });
  return view;
});

app.post<{ Params: { code: string } }>('/api/parties/:code/play', async (req, reply) => {
  const party = getParty(req.params.code);
  const memberId = (req.body as { member?: unknown } | undefined)?.member;
  if (!party || typeof memberId !== 'string') return reply.code(404).send({ error: 'Esa pareja ya no existe' });
  // S3-05: la pareja entra en la cola con el ELO de cada uno.
  const ratings: Record<string, number> = {};
  for (const m of party.members) ratings[m.id] = await readRating(m.playerId);
  const r = playParty(party, memberId, ratings);
  if (!r.ok) return reply.code(409).send({ error: r.error });
  return r.view;
});

app.post<{ Params: { code: string } }>('/api/parties/:code/cancel', async (req, reply) => {
  const party = getParty(req.params.code);
  const memberId = (req.body as { member?: unknown } | undefined)?.member;
  if (!party || typeof memberId !== 'string') return reply.code(404).send({ error: 'Esa pareja ya no existe' });
  cancelPartySearch(party, memberId);
  return viewParty(party, memberId);
});

app.post<{ Params: { code: string } }>('/api/parties/:code/name', async (req, reply) => {
  const party = getParty(req.params.code);
  const body = (req.body ?? {}) as { member?: unknown; name?: unknown };
  if (!party || typeof body.member !== 'string') return reply.code(404).send({ error: 'Esa pareja ya no existe' });
  renameMember(party, body.member, body.name);
  return { ok: true };
});

app.post<{ Params: { code: string } }>('/api/parties/:code/leave', async (req) => {
  const party = getParty(req.params.code);
  const memberId = (req.body as { member?: unknown } | undefined)?.member;
  if (party && typeof memberId === 'string') leaveParty(party, memberId);
  return { ok: true };
});

/**
 * S2-15: ¿sigue siendo mío el asiento de esta sala? El cliente lo
 * pregunta antes de volver a su `lastRoomCode`, para no meterse a ciegas
 * en una sala muerta, cerrada o donde ya le sustituyó un bot.
 */
app.get<{ Params: { code: string }; Querystring: { token?: string } }>('/api/rooms/:code/seat', async (req) => {
  const room = getRoom(req.params.code.toUpperCase());
  const token = req.query.token;
  const ok = !!room && !!token && !room.matchFinished && room.players.some((p) => p.token === token);
  return { ok };
});

// Health check simple para que el hosting (Cloudflare Tunnel, Fly, etc.)
// sepa si el server está vivo. NO toca la base de datos ni nada caro.
app.get('/healthz', async () => ({ ok: true, version: Date.now() }));

// ───────────── Static serving del bundle web ─────────────
// En dev seguimos sirviendo el web con `vite` (puerto 5173) y el
// server queda en :3001, conectado por CORS. En prod (y con túnel)
// el MISMO Fastify sirve el bundle del web desde su `apps/web/dist`
// y los clientes se conectan por la misma URL. SPA fallback: si
// piden un path sin extensión y no existe, devolvemos index.html.

const __filename = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
// En runtime (Node) `__dirname` es el directorio del módulo compilado
// (`apps/server/dist`). El bundle web está en `apps/web/dist`. Con
// `../web/dist` resolvemos desde `dist/`.
const WEB_DIST = resolvePath(__dirname, '..', '..', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(filePath: string, reply: import('fastify').FastifyReply) {
  try {
    const data = await readFile(filePath);
    reply.type(MIME[extname(filePath)] ?? 'application/octet-stream');
    // Cache en el cliente: 1 día. Los assets de Vite ya llevan hash
    // en el nombre (`index-ABCDEF.js`), así que cacheamos tranquilos.
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(data);
  } catch {
    return reply.code(404).send('Not found');
  }
}

app.get<{ Params: { path: string } }>('/assets/:path', async (req, reply) => {
  return serveStatic(join(WEB_DIST, 'assets', req.params.path), reply);
});

// SPA fallback para cualquier GET que no sea API, WS, healthz.
// Si no existe el archivo en disco, devolvemos index.html y que el
// cliente (que no usa router) decida qué hacer.
app.get<{ Params: { '*': string } }>('/*', async (req, reply) => {
  // Sanity: no servir nada bajo /api, /ws, /healthz — ya están
  // registradas arriba con sus handlers.
  if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.url.startsWith('/healthz')) {
    return reply.code(404).send('Not found');
  }
  const url = req.url.split('?')[0] ?? '/';
  const target =
    url === '/' || !url.includes('.')
      ? join(WEB_DIST, 'index.html')
      : join(WEB_DIST, url);
  return serveStatic(target, reply);
});

app.register(async (instance) => {
  // ───────────── WS: cola de "Jugar online" (S3-05) ─────────────
  // El cliente abre `/ws/matchmake?name=…` y queda en la cola mientras el
  // WS esté abierto (cerrarlo = cancelar). Cada segundo recibe
  // QUEUE_STATUS; al formarse la mesa, QUEUE_MATCHED con el código y el
  // token de su asiento, y entra a `/ws/<code>?token=…`.
  instance.get('/ws/matchmake', { websocket: true }, async (socket: WsSocket, req) => {
    const url = new URL(req.url, 'http://x');
    const playerId = resolvePlayerId(req, url.searchParams.get('pid'));
    const name = (url.searchParams.get('name') ?? 'Jugador').trim().slice(0, 20) || 'Jugador';
    const rating = await readRating(playerId);
    const id = `ws:${cryptoToken()}`;
    const since = Date.now();
    let status: NodeJS.Timeout | null = null;
    const stop = () => {
      if (status) clearInterval(status);
      status = null;
    };
    const sendStatus = () => {
      if (!isInQueue(id)) return stop();
      const waitedMs = Date.now() - since;
      send(socket, {
        type: 'QUEUE_STATUS',
        state: waitedMs >= BOT_FILL_AFTER_MS ? 'filling' : 'searching',
        waitedMs,
        humansFound: playersSearching(),
        fillAfterMs: BOT_FILL_AFTER_MS,
      });
    };
    qEnqueue({
      id,
      members: [{ playerId, name, rating }],
      enqueuedAt: since,
      notify: ({ roomCode, seats, tokens }) => {
        stop();
        send(socket, { type: 'QUEUE_MATCHED', roomCode, seat: seats[0]!, token: tokens[0]! });
        try { socket.close(); } catch { /* ignore */ }
      },
    });
    app.log.info(`[cola] entra ${name} pid=${playerId ?? '-'} rating=${rating} (en cola: ${listQueue().length})`);
    sendStatus();
    status = setInterval(sendStatus, 1000);
    socket.on('close', () => {
      stop();
      qDequeue(id);
    });
  });

  instance.get('/ws/:code', { websocket: true }, (socket: WsSocket, req) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const room = getRoom(code);
    if (!room) {
      send(socket, { type: 'ERROR', code: 'ROOM_NOT_FOUND', message: 'Sala no encontrada' });
      socket.close();
      return;
    }

    let seat = -1;
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token');
    // Identidad anónima para ELO: el cliente manda `?pid=<uuid>` (UUID
    // que recibió en POST /api/rooms). Si no, cae a la cookie leída
    // del upgrade request. Si tampoco hay cookie (modo memory), es
    // null y el seat queda sin playerId (no se actualiza ELO).
    // S3-01: con sesión manda la cuenta; si no, `?pid=` o la cookie anónima.
    const playerId = resolvePlayerId(req, url.searchParams.get('pid'));

    if (token) {
      const idx = room.players.findIndex((p) => p.token === token);
      if (idx >= 0) {
        seat = idx;
        // Mismo token desde otra pestaña / reconexión con la vieja aún
        // abierta: la conexión nueva se queda el seat y la vieja se cierra
        // con aviso, en vez de quedarse congelada sin recibir nada.
        const prev = room.players[seat]!.ws as unknown as WsSocket | null;
        if (prev && prev !== socket && prev.readyState === 1) {
          send(prev, { type: 'ERROR', code: 'SESSION_REPLACED', message: 'Has abierto esta partida en otra pestaña o ventana' });
          try { prev.close(); } catch { /* ignore */ }
        }
        room.players[seat]!.ws = socket as never;
        delete room.players[seat]!.reconnectDeadline;
        if (playerId) room.players[seat]!.playerId = playerId;
      }
    }
    if (seat < 0 && token && room.state !== null) {
      // S2-15/S2-12: trae token de ESTA sala pero ya no es de nadie → su
      // asiento lo ocupó un bot (o la partida se cerró). Sin reclamar: no
      // le damos otro asiento libre.
      send(socket, { type: 'ERROR', code: 'SEAT_LOST', message: 'Tu asiento lo ha ocupado un bot' });
      socket.close();
      return;
    }
    if (seat < 0 && room.state !== null && playerId && room.abandonedPlayerIds.has(playerId)) {
      // S2-12: quien abandonó (o no volvió en 45 s) no puede reclamar ni
      // ocupar otro asiento de esta mesa.
      send(socket, { type: 'ERROR', code: 'SEAT_LOST', message: 'Abandonaste esta partida; un bot ha ocupado tu asiento' });
      socket.close();
      return;
    }
    if (seat < 0) {
      // Los asientos `substitute` (bot que reemplazó a un humano) no se
      // pueden ocupar: S2-12, sin reclamar.
      const free = room.players.findIndex((p) => p.token === null && !p.substitute);
      if (free < 0) {
        send(socket, { type: 'ERROR', code: 'INTERNAL', message: 'Sala llena' });
        socket.close();
        return;
      }
      seat = free;
      room.players[seat]!.token = cryptoToken();
      room.players[seat]!.name = url.searchParams.get('name') ?? `Jugador ${seat + 1}`;
      if (playerId) room.players[seat]!.playerId = playerId;
      room.players[seat]!.ws = socket as never;
      // S2-14: con la partida ya repartida (mesa con bots), guardar el
      // token del nuevo humano; si no, tras un reinicio no recuperaría su asiento.
      if (room.state !== null) persistRoom(room, 'jugador se sienta');
    }

    // S4-02: su división (si tiene cuenta), para la insignia en la mesa.
    void loadSeatDivision(room, seat as Seat);
    send(socket, {
      type: 'WELCOME',
      you: seat,
      roomCode: room.code,
      seatNames: room.players.map((p) => p.name),
      isBot: room.players.map((p) => p.token === null),
      // Token opaco para reconectar al mismo seat si se cae el WS.
      // Se emite SIEMPRE — el cliente sabe si es nuevo o reconexión.
      // Re-conexiones: `p.token` ya estaba fijado por una conexión
      // anterior; lo reusamos para que el cliente pueda reclamar el
      // seat original sin que el server le asigne uno nuevo.
      token: room.players[seat]!.token ?? '',
    });
    if (room.state === null) {
      // Modo lobby: la sala está esperando a que se unan más humanos
      // antes de repartir. Emitimos LOBBY_STATUS al recién llegado y al
      // resto, y programamos la comprobación del lobby (rellenar con
      // bots al expirar la ventana).
      broadcastLobbyStatus(room);
      scheduleLobbyCheck(room);
    } else {
      emitAfterChange(room);
      // Si el primer turno (o cualquier turno) cae en un bot al conectar
      // (p. ej. mesa recién creada donde el dealer aleatorio deja a un bot
      // como primer jugador, o un reconnect a media partida), hay que
      // arrancar el ciclo de bots. Sin esto la partida se queda colgada
      // silenciosamente hasta que un humano intente tirar carta.
      void stepBots(room).catch(() => undefined);
      // S2-13: si la mesa está votando revancha (o el match ya se cerró),
      // el cliente que (re)conecta necesita ese estado para pintar el panel.
      sendPostgameStateTo(room, socket);
      // S2-12: avisar a todos de que este asiento vuelve a estar conectado.
      broadcastSeats(room);
    }

    // S2-15: latido. Un móvil que pierde la red (modo avión, cobertura) NO
    // cierra el WS: sin esto el server lo daba por conectado durante
    // minutos y la mesa esperaba 10 s por turno. Ping cada 5 s; si no
    // contesta (pong) antes del siguiente, cortamos → 'close' → se marca
    // desconectado y su turno lo juega el auto-play a los 2 s.
    const rawWs = socket as unknown as import('ws').WebSocket;
    let alive = true;
    rawWs.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (rawWs.readyState !== 1) { clearInterval(heartbeat); return; }
      if (!alive) {
        console.log(`[ws] code=${room.code} seat=${seat} sin respuesta al ping → cerrando`);
        clearInterval(heartbeat);
        rawWs.terminate();
        return;
      }
      alive = false;
      try { rawWs.ping(); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
    socket.on('close', () => clearInterval(heartbeat));

    // S3-03: el anfitrión puede mover a los jugadores de asiento en la mesa
    // privada; el asiento de esta conexión se recalcula en cada evento.
    const refreshSeat = () => {
      const i = room.players.findIndex((p) => (p.ws as unknown) === socket);
      if (i >= 0) seat = i;
    };

    socket.on('message', async (raw: unknown) => {
      alive = true;
      refreshSeat();
      const text = raw instanceof Buffer ? raw.toString() : String(raw);
      // Log de cada mensaje entrante para diagnóstico. Si una partida
      // se queda colgada, este log muestra qué envió el cliente por
      // última vez (o si dejó de enviar). Lo emite a stdout (no por
      // el logger de Fastify) para que sea fácil de `grep` junto a
      // los logs del auto-play.
      console.log(`[ws] code=${room.code} seat=${seat} msg=${text.slice(0, 200)}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        send(socket, { type: 'ERROR', code: 'BAD_MESSAGE', message: 'JSON inválido' });
        return;
      }
      const r = ClientMessageSchema.safeParse(parsed);
      if (!r.success) {
        send(socket, { type: 'ERROR', code: 'BAD_MESSAGE', message: r.error.message });
        return;
      }
      const msg = r.data;
      if (msg.type === 'PING') {
        send(socket, { type: 'PONG' });
        return;
      }
      // Voto de revancha (S2-13): si estamos en postgame, registramos
      // el voto del seat actual y, si todos los humanos ya son yes,
      // resolvemos inmediatamente.
      if (msg.type === 'REMATCH_VOTE') {
        if (!castRematchVote(room, seat as Seat, msg.accept)) {
          send(socket, { type: 'ERROR', code: 'BAD_MESSAGE', message: 'No hay votación de revancha abierta' });
        }
        return;
      }
      if (msg.type === 'PRIVATE_SWAP_SEATS' || msg.type === 'PRIVATE_START') {
        const err =
          msg.type === 'PRIVATE_SWAP_SEATS'
            ? swapPrivateSeats(room, seat as Seat, msg.a as Seat, msg.b as Seat)
            : startPrivate(room, seat as Seat, msg.botLevel, {
                partidasPorCoto: msg.partidasPorCoto ?? 3,
                cotosParaGanar: msg.cotosParaGanar ?? 1,
              });
        if (err) send(socket, { type: 'ERROR', code: 'BAD_MESSAGE', message: err });
        return;
      }
      if (msg.type === 'LEAVE') {
        // Abandono VOLUNTARIO. Liberamos el slot INMEDIATAMENTE (sin
        // backoff) y marcamos `leaving=true` para que el `socket.on('close')`
        // posterior no intente re-aplicar el backoff al cerrar el WS.
        // Bug Sprint 2.12: antes solo hacíamos `socket.close()`, lo que
        // dejaba el token del cliente intacto en el seat; si el cliente
        // pulsaba "Jugar con jugadores" justo después, matchmake reusaba
        // la misma sala (humans > 0) y el siguiente WS sin token entraba
        // al siguiente seat libre → el mismo cliente aparecía como 2
        // humanos en la sala.
        const p = room.players[seat];
        if (p && p.token !== null) {
          p.leaving = true;
          if (room.state === null) {
            // Sala en lobby: liberar el slot YA (sin penalización).
            p.token = null;
            p.name = '?';
            p.ws = null;
            delete p.playerId; // que nadie herede su ELO
            delete p.partyCode;
            delete p.division;
            p.leaving = false;
            scheduleLobbyCheck(room);
          } else if (room.postgame !== null) {
            // S2-13: abandonar durante la votación de revancha = voto `no`
            // → la mesa se cierra para todos. Sin penalización.
            abandonDuringPostgame(room, seat as Seat);
          } else if (!room.matchFinished) {
            // S2-12: abandono con la mesa en juego → bot definitivo. Si es a
            // mitad de partida, `substituteWithBot` aplica la derrota de ELO.
            substituteWithBot(room, seat as Seat, 'leave');
          }
        }
        socket.close();
        return;
      }
      if (msg.type === 'ACTION') {
        // Sprint 2.15+: log de diagnóstico para el bug "bot cambia el
        // 7 por una carta peor". Si alguna vez se ve un SWAP-IN con
        // trumpCard.rank ∉ {1, 3, 10, 11, 12}, hay un bug en el
        // filtro. Si NO sale esta línea → el SWAP_SEVEN ilegal ni
        // siquiera llegó al server (causa más probable: el bot/humano
        // ya había enviado otro flow, y lo que el usuario vio fue
        // otra cosa: un `draw()` del mazo+trunfo). Con esta línea
        // queda registrado cualquier intento de SWAP con su
        // trumpCard-context, así podemos reconstruir exactamente qué
        // pasó la próxima vez que el usuario reporte este caso.
        if (msg.action.type === 'SWAP_SEVEN') {
          const tc = room.state?.trumpCard;
          console.log(`[SWAP-IN] code=${room.code} seat=${seat} trumpCard=${tc ? `${tc.id} (rank=${tc.rank})` : 'null'} trump=${room.state?.trump}`);
        }
        if (room.seenCommandIds.has(msg.commandId)) return;
        // El humano ha actuado: cancelamos la red de seguridad del
        // auto-play para no encadenar acciones encima de las suyas.
        clearAutoPlayTimer(room);
        if (room.state === null) {
          // Sala todavía en lobby: no se puede aplicar ninguna acción.
          send(socket, { type: 'ERROR', code: 'NOT_YOUR_TURN', message: 'Aún esperando a más jugadores' });
          return;
        }
        room.seenCommandIds.add(msg.commandId);
        const finishedBefore = room.state.finishedTricks.length;
        // BUG histórico: aquí estaba `seat as 0`, un cast a literal 0.
        // Eso significaba que TODAS las acciones de cualquier seat se
        // aplicaban como si vinieran del seat 0. Para el primer jugador
        // (que siempre es seat 0) funcionaba "por accidente"; para el
        // segundo jugador, su acción se rechazaba siempre con
        // ILLEGAL_ACTION silencioso (el cliente solo veía que la carta
        // se oscurecía y el auto-play disparaba 10s después). Cambiado
        // a `seat as Seat` para pasar el seat real capturado en el
        // cierre del WS handler.
        const ok = applyActionWithResolveEvent(room, seat as Seat, msg.action);
        if (!ok) {
          send(socket, { type: 'ERROR', code: 'ILLEGAL_ACTION', message: 'Acción ilegal' });
          return;
        }
        // ¿La acción resolvió una baza? ¿Era la última?
        const last = room.state.finishedTricks[room.state.finishedTricks.length - 1];
        const trickJustResolved = room.state.finishedTricks.length > finishedBefore;
        const wasLastTrick = trickJustResolved && last?.hadLastTrick === true;

        // Si la mano acaba de terminar, emitimos el VIEW pero NO el GAME_OVER;
        // lo emitiremos después de la pausa para que el cliente vea la última
        // baza (10 de últimas) antes del modal.
        emitAfterChange(room, { skipGameOver: wasLastTrick });

        if (trickJustResolved) {
          // Sprint 2.21: pausa extra larga si la baza resuelta es la
          // última de la mano, para que el jugador pueda leer la jugada
          // final antes de que aparezca el GAME_OVER. Para bazas no
          // finales mantenemos la pausa corta (2,5 s) para no ralentizar
          // las bazas intermedias. Subida de 4,5 s → 7 s en línea con
          // el retardo del overlay "10 de últimas" del cliente (4 s) y
          // su duración en pantalla (6 s) = 10 s totales antes del panel.
          const pause = wasLastTrick ? 7000 : 2500;
          await new Promise<void>((r) => setTimeout(r, pause));
        } else {
          // Pausa para que el humano vea su carta antes de que el siguiente
          // bot actúe (como en una partida real).
          await new Promise<void>((r) => setTimeout(r, botThinkDelayMs()));
        }

        if (wasLastTrick) {
          // Ahora sí, emitimos el GAME_OVER después de la pausa.
          emitAfterChange(room, { skipGameOver: false });
          // Auto-cadencia: repartimos la siguiente mano tras una pausa
          // más larga (4,5 s) para que el jugador lea el panel de
          // resumen — sobre todo en los saltos entre idas/vueltas y
          // entre partidas, donde hay más info que procesar.
          setTimeout(() => triggerNextHand(room), 4500);
          return;
        }

        const acted = await stepBots(room);
        if (!acted) emitAfterChange(room);
        // Tras la cadena de bots, si quedó turno en un humano, armamos
        // la red de seguridad por si no actúa (10s).
        scheduleAutoPlay(room);
      }
      if (msg.type === 'NEXT_HAND') {
        // El cliente ha pulsado "Continuar" en el panel de resumen.
        // La sala está en phase: 'finished'; repartimos la siguiente.
        triggerNextHand(room);
      }
    });

    socket.on('close', () => {
      refreshSeat();
      const p = room.players[seat];
      if (!p) return;
      // Si el seat ya lo tiene otra conexión (misma sesión en otra
      // pestaña, o reconexión), el cierre de ESTE socket viejo no debe
      // tocar nada: antes ponía `ws = null` y a los 45 s liberaba el seat
      // del jugador que sí seguía conectado.
      if ((p.ws as unknown) !== socket) return;
      // LEAVE previo (Sprint 2.12): el cliente abandonó voluntariamente.
      // El handler de LEAVE ya liberó el slot (o lo hará cuando
      // scheduleLobbyCheck corra). No aplicamos backoff — solo
      // limpiamos la marca `leaving` para no contaminar futuros
      // handlers y dejamos `ws = null`.
      if (p.leaving) {
        p.leaving = false;
        p.ws = null;
        return;
      }
      // Drop ACCIDENTAL: WS se cierra sin LEAVE (p.ej. el cliente
      // pierde la red o cierra la pestaña). Para permitir la
      // re-conexión por token guardamos el token durante 45 s. Si el
      // cliente vuelve a abrir un WS con `?token=T` en esa ventana, el
      // server reconoce el token y reusa el mismo seat. Pasados los
      // 45 s sin reconexión, liberamos el slot definitivamente.
      markDisconnected(room, seat as Seat);
    });
  });
});

function send(ws: WsSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function cryptoToken(): string {
  return globalThis.crypto.randomUUID();
}

const port = Number(process.env.PORT ?? 3001);

/**
 * Selección del backend de persistencia.
 *
 *  - `PERSISTENCE_BACKEND=memory` (default, dev local): todo en RAM,
 *    las salas se pierden al reiniciar.
 *  - `PERSISTENCE_BACKEND=cosmos`: salas activas en RAM + snapshots
 *    en Azure Cosmos DB con TTL de 24h. Sobrevive a SIGTERM y a
 *    reinicios del contenedor. Requiere COSMOS_ENDPOINT y
 *    COSMOS_DATABASE en el entorno (ver apps/server/.env.example).
 *
 * Si el backend es Cosmos, además de montar el store, lee los snapshots
 * no caducados y recrea cada sala con su código original. El `state`
 * del juego (mano en curso, bazas, etc.) se pierde en esta versión —
 * queda como mejora para cuando se serialice el motor completo.
 */
async function initPersistence(): Promise<void> {
  const backend = process.env.PERSISTENCE_BACKEND ?? 'memory';
  if (backend === 'memory') {
    setRoomStore(new MemoryRoomStore());
    app.log.info('persistence: MemoryRoomStore (RAM only)');
    return;
  }
  if (backend === 'cosmos') {
    const config = readCosmosConfig();
    const handles = await initCosmos(config);
    setCosmosHandles(handles);
    const cosmosStore = new CosmosRoomStore(handles);
    setRoomStore(cosmosStore);
    app.log.info(`persistence: CosmosRoomStore (db=${config.database})`);
    // S2-14: los snapshots se guardan desde `room.ts` (reparto, fin de
    // mano, votación, sustitución) a través de este sink.
    setSnapshotSink({
      save: async (room) => {
        const snap = serializeRoom(room);
        if (snap) await cosmosStore.saveSnapshot(room.code, snap);
      },
      remove: (code) => cosmosStore.deleteSnapshot(code),
    });
    // Rehidratación: cada snapshot válido vuelve a ser una sala con su
    // partida tal cual se guardó. Los humanos empiezan desconectados (45 s
    // para reconectar; sus clientes reintentan solos con el token).
    try {
      const snapshots = await cosmosStore.loadActiveSnapshots();
      let rehydrated = 0;
      const seen = new Set<string>();
      for (const doc of snapshots) {
        const snap = doc.payload;
        if (!isRoomSnapshot(snap) || snap.matchFinished || seen.has(doc.tableId)) {
          // Snapshot antiguo (`{ code }`), duplicado o de un match cerrado → fuera.
          await cosmosStore.deleteSnapshotDoc(doc.id, doc.tableId).catch(() => undefined);
          continue;
        }
        seen.add(doc.tableId);
        const room = roomFromSnapshot(snap);
        cosmosStore.adopt(room);
        resumeRestoredRoom(room, { postgameOpen: snap.postgameOpen });
        rehydrated++;
        app.log.info(`rehydrated room ${room.code} (vuelta=${room.state?.vuelta} phase=${room.state?.phase} matchWins=${JSON.stringify(room.matchWins)})`);
      }
      app.log.info(`rehydrated ${rehydrated} room(s) from Cosmos snapshots`);
    } catch (err) {
      app.log.warn({ err }, 'rehydrate failed (continuing without snapshots)');
    }
    return;
  }
  throw new Error(`PERSISTENCE_BACKEND desconocido: ${backend}`);
}

/**
 * Snapshot de emergencia al recibir SIGTERM. Antes de cerrar, persiste
 * el estado actual de cada sala activa para que el próximo arranque
 * pueda rehidratarlas.
 *
 * Esto depende de `gracefulShutdown` del hosting (ACA, Fly, etc.):
 * si el orchestrador mata el proceso sin dar tiempo, no hay nada
 * que hacer. ACA permite configurar `terminationGracePeriodSeconds`,
 * que en SPRINT2.md S2-16 se fija a ≥60s.
 */
async function snapshotOnSigterm(): Promise<void> {
  app.log.info('SIGTERM received, snapshotting active rooms…');
  const store = (await import('./rooms.js')).getRoomStore();
  const cosmosStore = store as unknown as { saveSnapshot?: (id: string, payload: unknown) => Promise<void> };
  if (typeof cosmosStore.saveSnapshot !== 'function') {
    app.log.info('no Cosmos backend active, skipping snapshot');
    return;
  }
  // S2-14: estado completo y actual (también a mitad de mano: es más
  // reciente que el del último fin de mano). Lobbies y matches cerrados no.
  let n = 0;
  for (const room of store.list()) {
    if (room.matchFinished) continue;
    const snap = serializeRoom(room);
    if (!snap) continue;
    try {
      await cosmosStore.saveSnapshot(room.code, snap);
      n++;
    } catch (err) {
      app.log.warn({ err }, `snapshot failed for ${room.code}`);
    }
  }
  app.log.info(`snapshotted ${n} rooms`);
}

process.on('SIGTERM', async () => {
  await snapshotOnSigterm();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await snapshotOnSigterm();
  process.exit(0);
});

/**
 * S3-05: tick de la cola. Cada segundo forma las mesas posibles y crea
 * sus salas; además cancela búsquedas de parejas que ya no miran.
 */
let matchmakingTimer: NodeJS.Timeout | null = null;

async function tickMatchmaking(): Promise<void> {
  dropStaleSearches();
  for (const table of formTables()) startQueuedTable(table);
}

function startMatchmakingTick(): void {
  if (matchmakingTimer !== null) return;
  matchmakingTimer = setInterval(() => {
    tickMatchmaking().catch((err) => app.log.error({ err }, 'matchmaking tick failed'));
  }, 1000);
}

initPersistence()
  .then(() => {
    startMatchmakingTick();
    return app
      .listen({ port, host: '0.0.0.0' })
      .then(() => app.log.info(`guinote server listening on :${port}`));
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
