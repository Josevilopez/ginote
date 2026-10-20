/**
 * S5-02: avisos push (Web Push con claves VAPID, sin servicios de pago).
 *
 * - El navegador nos da una "suscripción" (URL de Google/Apple/Mozilla +
 *   claves). Se guarda en `pushSubs` (PK `/userId`), una por dispositivo.
 * - Al pasar algo (invitación, solicitud de amistad) se manda el aviso a
 *   todas las suscripciones de la cuenta; las caducadas (404/410) se borran.
 * - Preferencias por tipo en el doc del usuario (`pushPrefs`); por defecto, todo sí.
 *
 *  GET  /api/push/config       → { publicKey } (null = push desactivado)
 *  POST /api/push/subscribe    { subscription } → guarda este dispositivo
 *  POST /api/push/unsubscribe  { endpoint }     → lo quita
 *  GET  /api/push/prefs        → { invite, request, devices }
 *  PUT  /api/push/prefs        { invite?, request? }
 */
import { createHash } from 'node:crypto';
import type { Container } from '@azure/cosmos';
import type { FastifyInstance } from 'fastify';
import type { User, UserRepo } from './auth/accounts.js';
import type { Session } from './auth/session.js';

export type PushKind = 'invite' | 'request';
export interface PushPrefs {
  invite: boolean;
  request: boolean;
}
export const DEFAULT_PREFS: PushPrefs = { invite: true, request: true };
export const MAX_DEVICES = 10;

export interface PushSub {
  id: string;
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Adónde lleva al tocarlo (ruta de la web, p. ej. `/#amigos`). */
  url: string;
  /** Avisos con la misma etiqueta se sustituyen en vez de amontonarse. */
  tag: string;
  /** Segundos que el aviso tiene sentido (si el móvil está apagado más tiempo, no llega). */
  ttl: number;
}

/** Envía un aviso cifrado. Lanza `{ statusCode }` si el servicio lo rechaza. */
export type PushSender = (sub: PushSub, payload: string, opts: { TTL: number; urgency: 'high' | 'normal'; topic?: string }) => Promise<void>;

export function subId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('base64url').slice(0, 32);
}

export function prefsOf(user: User | null): PushPrefs {
  const p = (user as (User & { pushPrefs?: Partial<PushPrefs> }) | null)?.pushPrefs;
  return { ...DEFAULT_PREFS, ...(p ?? {}) };
}

/** Valida lo que manda el navegador (`PushSubscription.toJSON()`). */
export function parseSubscription(raw: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== 'string' || r.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const p256dh = r.keys?.p256dh;
  const auth = r.keys?.auth;
  const b64 = /^[A-Za-z0-9_\-+/=]{8,200}$/;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !b64.test(p256dh) || !b64.test(auth)) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

// ───────────── Repos ─────────────

export interface PushRepo {
  list(userId: string): Promise<PushSub[]>;
  put(sub: PushSub): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
  removeAll(userId: string): Promise<void>;
}

export class MemoryPushRepo implements PushRepo {
  readonly map = new Map<string, PushSub>();
  async list(userId: string) {
    return [...this.map.values()].filter((s) => s.userId === userId).map((s) => structuredClone(s));
  }
  async put(s: PushSub) {
    // Un mismo navegador que cambia de cuenta: la suscripción pasa a la nueva.
    for (const [k, v] of this.map) if (v.id === s.id && v.userId !== s.userId) this.map.delete(k);
    this.map.set(`${s.userId}:${s.id}`, structuredClone(s));
  }
  async remove(userId: string, id: string) {
    this.map.delete(`${userId}:${id}`);
  }
  async removeAll(userId: string) {
    for (const [k, v] of this.map) if (v.userId === userId) this.map.delete(k);
  }
}

export class CosmosPushRepo implements PushRepo {
  constructor(private readonly c: Container) {}
  async list(userId: string) {
    const { resources } = await this.c.items
      .query<PushSub>({ query: 'SELECT * FROM c WHERE c.userId = @u', parameters: [{ name: '@u', value: userId }] }, { partitionKey: userId })
      .fetchAll();
    return resources.map((r) => ({ id: r.id, userId: r.userId, endpoint: r.endpoint, keys: r.keys, createdAt: r.createdAt }));
  }
  async put(s: PushSub) {
    await this.c.items.upsert(s);
  }
  async remove(userId: string, id: string) {
    try {
      await this.c.item(id, userId).delete();
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
  }
  async removeAll(userId: string) {
    for (const s of await this.list(userId)) await this.remove(userId, s.id);
  }
}

// ───────────── Envío ─────────────

export class Pusher {
  constructor(
    private readonly repo: () => PushRepo,
    private readonly users: () => UserRepo,
    private readonly sender: PushSender | null,
    private readonly log: (msg: string, err?: unknown) => void = () => undefined,
  ) {}

  get enabled(): boolean {
    return this.sender !== null;
  }

  /** Manda el aviso a todos los dispositivos de la cuenta. Devuelve cuántos lo aceptaron. */
  async notify(userId: string, kind: PushKind, msg: PushMessage): Promise<number> {
    if (!this.sender) return 0;
    const user = await this.users().get(userId);
    if (!user || !prefsOf(user)[kind]) return 0;
    const subs = await this.repo().list(userId);
    const payload = JSON.stringify(msg);
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await this.sender!(sub, payload, { TTL: msg.ttl, urgency: kind === 'invite' ? 'high' : 'normal' });
          sent++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            // El navegador ya no la quiere (permiso quitado, app desinstalada…).
            await this.repo().remove(userId, sub.id).catch(() => undefined);
          } else {
            this.log(`[push] fallo al enviar (status=${code ?? '?'})`, err);
          }
        }
      }),
    );
    return sent;
  }
}

/** Con claves VAPID en el entorno, un `PushSender` con `web-push`; si no, null. */
export async function initPushSender(env: NodeJS.ProcessEnv = process.env): Promise<{ sender: PushSender; publicKey: string } | null> {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT?.trim() && env.VAPID_SUBJECT.trim() !== 'mailto:' ? env.VAPID_SUBJECT.trim() : 'mailto:guinote@example.invalid';
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const sender: PushSender = async (sub, payload, opts) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, opts);
  };
  return { sender, publicKey };
}

// ───────────── Rutas ─────────────

export interface PushRouteOptions {
  sessionOf: (req: { headers: { cookie?: string | undefined } }) => Session | null;
  users: () => UserRepo;
  repo: () => PushRepo;
  publicKey: string | null;
}

export function registerPushRoutes(app: FastifyInstance, opts: PushRouteOptions): void {
  app.get('/api/push/config', async () => ({ publicKey: opts.publicKey }));

  app.post('/api/push/subscribe', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Inicia sesión para recibir avisos' });
    if (!opts.publicKey) return reply.code(503).send({ error: 'Los avisos no están activados en el servidor' });
    const sub = parseSubscription((req.body as { subscription?: unknown } | undefined)?.subscription);
    if (!sub) return reply.code(400).send({ error: 'Suscripción no válida' });
    const repo = opts.repo();
    try {
      const mine = await repo.list(s.uid);
      const id = subId(sub.endpoint);
      // Como mucho MAX_DEVICES: si hay más, se olvida el más antiguo.
      const others = mine.filter((x) => x.id !== id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const old of others.slice(0, Math.max(0, others.length - (MAX_DEVICES - 1)))) await repo.remove(s.uid, old.id);
      await repo.put({ id, userId: s.uid, ...sub, createdAt: new Date().toISOString() });
    } catch (err) {
      req.log.error({ err }, '[push] no se pudo guardar la suscripción');
      return reply.code(503).send({ error: 'No se pudo activar. Inténtalo más tarde.' });
    }
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint;
    if (typeof endpoint !== 'string') return reply.code(400).send({ error: 'Falta el dispositivo' });
    await opts
      .repo()
      .remove(s.uid, subId(endpoint))
      .catch((err) => req.log.error({ err }, '[push] no se pudo borrar la suscripción'));
    return { ok: true };
  });

  app.get('/api/push/prefs', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const user = await opts.users().get(s.uid);
    const devices = await opts
      .repo()
      .list(s.uid)
      .then((l) => l.length)
      .catch(() => 0);
    return { ...prefsOf(user), devices };
  });

  app.put('/api/push/prefs', async (req, reply) => {
    const s = opts.sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'Sin sesión' });
    const body = (req.body ?? {}) as Partial<Record<keyof PushPrefs, unknown>>;
    const users = opts.users();
    const user = await users.get(s.uid);
    if (!user) return reply.code(404).send({ error: 'Cuenta no encontrada' });
    const prefs = prefsOf(user);
    for (const k of ['invite', 'request'] as const) if (typeof body[k] === 'boolean') prefs[k] = body[k] as boolean;
    await users.put({ ...user, pushPrefs: prefs } as User);
    return prefs;
  });
}

// ───────────── Singleton del proceso ─────────────

const memoryPush = new MemoryPushRepo();
let override: PushRepo | null = null;

/** Cosmos si está activo; si no, memoria. */
export function pushRepo(getContainer: () => Container | null): PushRepo {
  if (override) return override;
  const c = getContainer();
  return c ? new CosmosPushRepo(c) : memoryPush;
}
export function setPushRepo(r: PushRepo | null): void {
  override = r;
}
