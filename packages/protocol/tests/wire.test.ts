import { describe, it, expect } from 'vitest';
import { ClientMessageSchema } from '../src/index.js';

describe('Protocolo — ClientMessage', () => {
  it('valida HELLO', () => {
    const r = ClientMessageSchema.safeParse({
      type: 'HELLO',
      name: 'Pepe',
      roomCode: 'ABCD',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza HELLO con roomCode inválido', () => {
    const r = ClientMessageSchema.safeParse({
      type: 'HELLO',
      name: 'Pepe',
      roomCode: 'ab', // minúsculas y corto
    });
    expect(r.success).toBe(false);
  });

  it('valida ACTION con PLAY_CARD', () => {
    const r = ClientMessageSchema.safeParse({
      type: 'ACTION',
      commandId: 'cmd-1',
      action: { type: 'PLAY_CARD', cardId: 'oros-1' },
    });
    expect(r.success).toBe(true);
  });

  it('rechaza ACTION con action inválida', () => {
    const r = ClientMessageSchema.safeParse({
      type: 'ACTION',
      commandId: 'cmd-1',
      action: { type: 'UNKNOWN' },
    });
    expect(r.success).toBe(false);
  });
});
