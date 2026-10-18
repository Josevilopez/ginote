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
  z.object({
    type: z.literal('QUEUE_JOIN'),
    mode: z.union([z.literal(2), z.literal(4)]),
    fill: z.enum(['bots', 'humansOnly']),
  }),
  z.object({
    type: z.literal('QUEUE_LEAVE'),
  }),
  z.object({
    type: z.literal('REMATCH_VOTE'),
    accept: z.boolean(),
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
    /** S2-13: partidas ganadas por equipo en el match (primero a 3). */
    matchWins: z.object({ '0': z.number().int().min(0), '1': z.number().int().min(0) }).optional(),
  }),
  z.object({
    type: z.literal('ERROR'),
    code: z.enum(['BAD_MESSAGE', 'NOT_YOUR_TURN', 'ILLEGAL_ACTION', 'ROOM_NOT_FOUND', 'SEAT_LOST', 'INTERNAL']),
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
    /**
     * Sprint 2.16: separación de conceptos del guiñote. `true` cuando
     * esta baza agota las cartas para repartir (mazo + triunfo <= 4
     * antes del draw) — equivale a "¡Vamos de últimas!" en el sentido
     * de aviso de transbordo a arrastre. NO confundir con `isLastTrick`:
     * en una mano típica, `isArrastreEntrance` salta en la 4ª baza y
     * `isLastTrick` en la 10ª (última baza total de la mano, la que se
     * lleva el bonus "10 de últimas").
     */
    isArrastreEntrance: z.boolean(),
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
  z.object({
    type: z.literal('QUEUE_STATUS'),
    state: z.enum(['searching', 'filling']),
    waitedMs: z.number().int().min(0),
    humansFound: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('QUEUE_MATCHED'),
    roomCode: z.string(),
    seat: z.number().int().min(0).max(3),
  }),
  z.object({
    type: z.literal('REMATCH_STATUS'),
    deadline: z.number().int().min(0), // epoch ms del server
    votes: z.record(z.enum(['pending', 'yes', 'no'])),
    matchWins: z.object({ '0': z.number().int().min(0), '1': z.number().int().min(0) }),
  }),
  z.object({
    type: z.literal('MATCH_ENDED'),
    /** Equipo campeón, o `null` si el match se cerró en empate de matchWins. */
    winner: z.union([z.literal(0), z.literal(1)]).nullable(),
    /** Motivo del cierre: alguien llegó a 3, rechazo/timeout de revancha, o abandono. */
    reason: z.enum(['won', 'declined', 'timeout', 'abandoned']),
    matchWins: z.object({ '0': z.number().int().min(0), '1': z.number().int().min(0) }),
  }),
  /** S2-12/S2-15: estado de cada asiento. Se emite al cambiar (desconexión,
   *  reconexión, sustitución por bot). `substitute` = bot que ha tomado
   *  definitivamente el asiento de un humano que abandonó o no volvió en 90 s. */
  z.object({
    type: z.literal('SEATS'),
    seatNames: z.array(z.string()),
    seatKinds: z.array(z.enum(['human', 'disconnected', 'bot', 'substitute'])),
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
