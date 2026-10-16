import { z } from 'zod';

/**
 * Mensajes del cliente al servidor.
 *
 * Cada cliente envía exactamente uno de estos. El servidor valida con zod,
 * luego valida con `legalActions` del motor, y aplica con `apply`.
 */
export const SuitSchema = z.enum(['oros', 'copas', 'espadas', 'bastos']);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('HELLO'),
    name: z.string().min(1).max(20),
    roomCode: z.string().regex(/^[A-Z0-9]{4,8}$/),
    resumeToken: z.string().optional(),
  }),
  z.object({
    type: z.literal('CREATE_ROOM'),
    name: z.string().min(1).max(20),
    fillWithBots: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('LEAVE'),
  }),
  z.object({
    type: z.literal('READY'),
  }),
  z.object({
    type: z.literal('ACTION'),
    commandId: z.string().min(1).max(40),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('PLAY_CARD'), cardId: z.string() }),
      z.object({ type: z.literal('SWAP_SEVEN') }),
      z.object({
        type: z.literal('SING_CANTE'),
        suit: SuitSchema,
        pair: z.tuple([z.number(), z.number()]).readonly(),
      }),
      z.object({ type: z.literal('PASS') }),
    ]),
  }),
  z.object({
    type: z.literal('PING'),
  }),
  z.object({
    type: z.literal('NEXT_HAND'),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * Mensajes del servidor al cliente.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('WELCOME'),
    you: z.number().int().min(0).max(3),
    roomCode: z.string(),
    seatNames: z.array(z.string()),
    isBot: z.array(z.boolean()),
    /**
     * Token opaco que identifica esta conexión concreta del cliente.
     * El cliente lo guarda en localStorage (clave `guinote:token:<code>`)
     * para poder reclamar el mismo `seat` si pierde conexión y vuelve.
     * Si el server detecta el token en el `?token=` de un nuevo WS,
     * prefiere ese seat sobre "primer slot libre".
     */
    token: z.string(),
  }),
  z.object({
    type: z.literal('VIEW'),
    view: z.unknown(), // PlayerView (definido en el motor, se valida en runtime)
    version: z.number().int(),
    // Estado de la progresión partida → coto → match. El servidor
    // lo envía siempre para que el cliente pueda pintar el marcador
    // y decidir qué panel mostrar al acabar una mano. `partidas` y
    // `cotos` son records indexados por team (0/1). El motor
    // solo rastrea la partida actual; el resto lo lleva el servidor.
    partidas: z.object({ '0': z.number(), '1': z.number() }).optional(),
    cotos: z.object({ '0': z.number(), '1': z.number() }).optional(),
    partidaEnCoto: z.number().int().optional(),
    cotoEnMatch: z.number().int().optional(),
    matchFinished: z.boolean().optional(),
    matchChampion: z.union([z.literal(0), z.literal(1)]).nullable().optional(),
  }),
  z.object({
    type: z.literal('ERROR'),
    code: z.enum(['BAD_MESSAGE', 'NOT_YOUR_TURN', 'ILLEGAL_ACTION', 'ROOM_NOT_FOUND', 'INTERNAL']),
    message: z.string(),
  }),
  z.object({
    type: z.literal('GAME_OVER'),
    handPoints: z.object({ '0': z.number(), '1': z.number() }),
    gamePoints: z.object({ '0': z.number(), '1': z.number() }),
    /** Score acumulado de la partida (buenas/malas por equipo). */
    score: z.object({
      buenas: z.object({ '0': z.number(), '1': z.number() }),
      malas: z.object({ '0': z.number(), '1': z.number() }),
    }).optional(),
    /** Vuelta actual (1-based). */
    vuelta: z.number().int().optional(),
    /** Si la partida ya terminó, este campo trae al ganador (0 o 1). */
    matchWinner: z.union([z.literal(0), z.literal(1)]).nullable().optional(),
  }),
  z.object({
    type: z.literal('PONG'),
  }),
  z.object({
    type: z.literal('TRICK_JUST_RESOLVED'),
    winner: z.number().int().min(0).max(3),
    plays: z.array(z.object({ seat: z.number().int().min(0).max(3), card: z.unknown() })),
    points: z.number().int(),
    isLastTrick: z.boolean(),
  }),
  z.object({
    type: z.literal('MATCH_OVER'),
    winner: z.union([z.literal(0), z.literal(1)]),
    score: z.object({
      buenas: z.object({ '0': z.number(), '1': z.number() }),
      malas: z.object({ '0': z.number(), '1': z.number() }),
    }),
    vuelta: z.number().int(),
  }),
  /** Empezado por el servidor justo después de aplicar un SWAP_SEVEN.
   *  El cliente lo usa para mostrar el overlay centrado (igual que el
   *  cante). `taken` es la carta del triunfo que el jugador ha cogido
   *  (ahora en su poder) y `given` es el 7 que ha soltado (ahora en
   *  el mazo como trumpCard). */
  z.object({
    type: z.literal('SWAP_HAPPENED'),
    seat: z.number().int().min(0).max(3),
    taken: z.unknown(), // Card (recibida del motor, validada en runtime)
    given: z.unknown(), // Card
  }),
  /** Estado del lobby. Se emite cuando la sala está esperando a que se
   *  unan más humanos antes de repartir. El cliente lo usa para mostrar
   *  "Esperando más jugadores… Ns". `endsAt` es epoch ms o `null` si la
   *  sala ya pasó la ventana (no debería pasar, pero lo contemplamos).
   *  `windowMs` es la duración inicial de la ventana — el cliente lo usa
   *  para dimensionar la barra depleting correctamente. */
  z.object({
    type: z.literal('LOBBY_STATUS'),
    code: z.string(),
    seatsConnected: z.number().int().min(0).max(4),
    seatsTotal: z.number().int(),
    endsAt: z.number().int().nullable(),
    windowMs: z.number().int(),
    seatNames: z.array(z.string()),
    isBot: z.array(z.boolean()),
  }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
