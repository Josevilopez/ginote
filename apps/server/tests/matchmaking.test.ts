import { describe, it, expect, beforeEach } from 'vitest';
import {
  BOT_FILL_AFTER_MS,
  enqueue,
  isInQueue,
  listQueue,
  queueSize,
  dequeue,
  ratingWindow,
  tryFormMatch,
  type Ticket,
} from '../src/matchmaking.js';

// Crea un ticket con rating y enqueuedAt concretos (útil para tests con
// tiempo fijo).
function ticket(rating: number, opts: Partial<Ticket> = {}): Ticket {
  return {
    playerId: `p-${Math.random().toString(36).slice(2, 8)}`,
    mode: 4,
    fill: 'bots',
    rating,
    enqueuedAt: Date.now(),
    ws: null,
    name: 'test',
    ...opts,
  };
}

// Antes de cada test, vaciamos la cola (el módulo tiene singleton).
beforeEach(() => {
  while (listQueue().length > 0) {
    dequeue(listQueue()[0]!.playerId);
  }
});

describe('matchmaking.ratingWindow', () => {
  it('empieza en 100', () => {
    const t = ticket(1000);
    expect(ratingWindow(t)).toBe(100);
  });
  it('crece a 150 tras 5s', () => {
    const t = ticket(1000, { enqueuedAt: Date.now() - 5_000 });
    expect(ratingWindow(t)).toBe(150);
  });
  it('crece a 250 tras 15s (3 steps)', () => {
    const t = ticket(1000, { enqueuedAt: Date.now() - 15_000 });
    expect(ratingWindow(t)).toBe(250);
  });
  it('tope en 400 a partir de 30s', () => {
    const t = ticket(1000, { enqueuedAt: Date.now() - 60_000 });
    expect(ratingWindow(t)).toBe(400);
  });
});

describe('matchmaking.tryFormMatch', () => {
  it('no forma con menos de N tickets', () => {
    enqueue(ticket(1000));
    enqueue(ticket(1100));
    enqueue(ticket(900));
    expect(tryFormMatch()).toHaveLength(0);
  });

  it('forma una mesa con 4 tickets compatibles', () => {
    enqueue(ticket(1000, { playerId: 'a' }));
    enqueue(ticket(1050, { playerId: 'b' }));
    enqueue(ticket(950, { playerId: 'c' }));
    enqueue(ticket(1100, { playerId: 'd' }));
    const formed = tryFormMatch();
    expect(formed).toHaveLength(1);
    expect(formed[0]!.tickets).toHaveLength(4);
    expect(new Set(formed[0]!.tickets.map((t) => t.playerId))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('NO forma si las ratings exceden la ventana', () => {
    enqueue(ticket(1000, { playerId: 'a' }));
    enqueue(ticket(1500, { playerId: 'b' })); // diff 500 > ventana 100
    enqueue(ticket(1100, { playerId: 'c' }));
    enqueue(ticket(1050, { playerId: 'd' }));
    expect(tryFormMatch()).toHaveLength(0);
  });

  it('forma si la ventana crece con el tiempo', () => {
    const longAgo = Date.now() - 60_000; // ventana 400
    enqueue(ticket(1000, { playerId: 'a', enqueuedAt: longAgo }));
    enqueue(ticket(1400, { playerId: 'b', enqueuedAt: longAgo })); // diff 400, justo en el borde
    enqueue(ticket(1050, { playerId: 'c', enqueuedAt: longAgo }));
    enqueue(ticket(1350, { playerId: 'd', enqueuedAt: longAgo }));
    expect(tryFormMatch()).toHaveLength(1);
  });

  it('NO encaja fill=bots con fill=humansOnly', () => {
    enqueue(ticket(1000, { playerId: 'a', fill: 'bots' }));
    enqueue(ticket(1050, { playerId: 'b', fill: 'humansOnly' }));
    enqueue(ticket(950, { playerId: 'c', fill: 'bots' }));
    enqueue(ticket(1100, { playerId: 'd', fill: 'bots' }));
    expect(tryFormMatch()).toHaveLength(0);
  });

  it('cuenta con fill=humansOnly si todos son humansOnly', () => {
    enqueue(ticket(1000, { playerId: 'a', fill: 'humansOnly' }));
    enqueue(ticket(1050, { playerId: 'b', fill: 'humansOnly' }));
    enqueue(ticket(950, { playerId: 'c', fill: 'humansOnly' }));
    enqueue(ticket(1100, { playerId: 'd', fill: 'humansOnly' }));
    expect(tryFormMatch()).toHaveLength(1);
  });

  it('match para 2 jugadores', () => {
    enqueue(ticket(1000, { playerId: 'a', mode: 2 }));
    enqueue(ticket(1100, { playerId: 'b', mode: 2 }));
    expect(tryFormMatch()).toHaveLength(1);
  });

  it('match entre modos no se mezclan', () => {
    // 4 tickets de mode 2 (se forman 2 mesas de 2) + 4 de mode 4 (1 mesa).
    // Ratings dentro de la ventana ±100 para que todos encajen.
    enqueue(ticket(1000, { playerId: 'a', mode: 2 }));
    enqueue(ticket(1020, { playerId: 'b', mode: 2 }));
    enqueue(ticket(1040, { playerId: 'c', mode: 2 }));
    enqueue(ticket(1060, { playerId: 'd', mode: 2 }));
    enqueue(ticket(1000, { playerId: 'e', mode: 4 }));
    enqueue(ticket(1050, { playerId: 'f', mode: 4 }));
    enqueue(ticket(1020, { playerId: 'g', mode: 4 }));
    enqueue(ticket(1010, { playerId: 'h', mode: 4 }));
    const formed = tryFormMatch();
    expect(formed).toHaveLength(3);
    expect(formed.filter((m) => m.tickets.length === 2)).toHaveLength(2);
    expect(formed.filter((m) => m.tickets.length === 4)).toHaveLength(1);
  });

  it('después de formar, los tickets sobrantes siguen en cola', () => {
    // 5 tickets de mode 4 con ratings compatibles: forman 1 mesa y
    // sobra 1. El sort por distancia puede meter al 5º en el slice;
    // para garantizar que sobra uno, los ratings están MUY próximos
    // y uno está fuera de la ventana. Aquí 5 tickets con ratings
    // [1000, 1010, 1020, 1030, 2000] — los 4 primeros encajan, el 5º
    // está fuera de la ventana ±100 del primero (1000+100=1100 < 2000).
    enqueue(ticket(1000, { playerId: 'a' }));
    enqueue(ticket(1010, { playerId: 'b' }));
    enqueue(ticket(1020, { playerId: 'c' }));
    enqueue(ticket(1030, { playerId: 'd' }));
    enqueue(ticket(2000, { playerId: 'e' }));
    const formed = tryFormMatch();
    expect(formed).toHaveLength(1);
    // 'e' tiene rating 2000, ventana ±100 vs los demás (±100 ≤2000): está fuera
    // debe seguir en cola
    expect(isInQueue('e')).toBe(true);
  });

  it('queueSize refleja el estado real', () => {
    expect(queueSize()).toBe(0);
    enqueue(ticket(1000, { playerId: 'x' }));
    enqueue(ticket(1100, { playerId: 'y' }));
    expect(queueSize()).toBe(2);
  });
});

describe('matchmaking.dequeue', () => {
  it('quita por playerId', () => {
    enqueue(ticket(1000, { playerId: 'x' }));
    expect(dequeue('x')).toBe(true);
    expect(queueSize()).toBe(0);
  });
  it('devuelve false si no existe', () => {
    expect(dequeue('nonexistent')).toBe(false);
  });
});

describe('matchmaking.botFillWindow', () => {
  it('BOT_FILL_AFTER_MS = 10s', () => {
    expect(BOT_FILL_AFTER_MS).toBe(10_000);
  });
});