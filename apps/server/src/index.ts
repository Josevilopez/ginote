import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { ClientMessageSchema, type ServerMessage } from '@guinote/protocol';
import { createRoomWithBots, getRoom } from './rooms.js';
import { applyActionWithResolveEvent, emitAfterChange, stepBots } from './room.js';

type WsSocket = {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  readyState: number;
};

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.post('/api/rooms', async (req, reply) => {
  const body = (req.body ?? {}) as { name?: string };
  const name = (body.name ?? 'Jugador').slice(0, 20);
  const room = createRoomWithBots();
  return { code: room.code, name };
});

app.get('/api/health', async () => ({ ok: true }));

app.register(async (instance) => {
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
    if (token) {
      const idx = room.players.findIndex((p) => p.token === token);
      if (idx >= 0) {
        seat = idx;
        room.players[seat]!.ws = socket as never;
      }
    }
    if (seat < 0) {
      const free = room.players.findIndex((p) => p.token === null);
      if (free < 0) {
        send(socket, { type: 'ERROR', code: 'INTERNAL', message: 'Sala llena' });
        socket.close();
        return;
      }
      seat = free;
      room.players[seat]!.token = cryptoToken();
      room.players[seat]!.name = url.searchParams.get('name') ?? `Jugador ${seat + 1}`;
      room.players[seat]!.ws = socket as never;
    }

    send(socket, {
      type: 'WELCOME',
      you: seat,
      roomCode: room.code,
      seatNames: room.players.map((p) => p.name),
      isBot: room.players.map((p) => p.token === null),
    });
    emitAfterChange(room);

    socket.on('message', async (raw: unknown) => {
      const text = raw instanceof Buffer ? raw.toString() : String(raw);
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
      if (msg.type === 'LEAVE') {
        socket.close();
        return;
      }
      if (msg.type === 'ACTION') {
        if (room.seenCommandIds.has(msg.commandId)) return;
        room.seenCommandIds.add(msg.commandId);
        const finishedBefore = room.state.finishedTricks.length;
        const ok = applyActionWithResolveEvent(room, seat as 0, msg.action);
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
          // Pausa para que se vea la baza resuelta, sea la última o no.
          await new Promise<void>((r) => setTimeout(r, 4000));
        } else {
          // Pausa para que el humano vea su carta antes de que el siguiente
          // bot actúe (como en una partida real).
          await new Promise<void>((r) => setTimeout(r, 1000));
        }

        if (wasLastTrick) {
          // Ahora sí, emitimos el GAME_OVER después de la pausa.
          emitAfterChange(room, { skipGameOver: false });
          return;
        }

        const acted = await stepBots(room);
        if (!acted) emitAfterChange(room);
      }
    });

    socket.on('close', () => {
      if (room.players[seat]) room.players[seat]!.ws = null;
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
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`guinote server listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
