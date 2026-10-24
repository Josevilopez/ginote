import { describe, expect, it, vi } from 'vitest';
import { LIVE_MIN, LIVE_WINDOW_MS, Visitors, cached, countLive, publicLive } from '../src/live.js';

describe('jugadores conectados', () => {
  it('cuenta personas distintas en la ventana de un minuto', () => {
    const v = new Visitors();
    v.touch('p:a', 0);
    v.touch('p:b', 10_000);
    v.touch('p:a', 20_000);
    expect(v.active(30_000)).toEqual(new Set(['p:a', 'p:b']));
    expect(v.active(10_000 + LIVE_WINDOW_MS + 1)).toEqual(new Set(['p:a']));
  });

  it('une visitantes y conectados sin contar dos veces', () => {
    expect(countLive(['p:a', 'p:b', 'n:x'], ['p:a', 's:ABCD:1', 'q:e1:0'])).toBe(5);
  });

  it('no publica cifras pequeñas', () => {
    expect(publicLive(LIVE_MIN - 1)).toEqual({ players: null });
    expect(publicLive(LIVE_MIN)).toEqual({ players: LIVE_MIN });
    expect(publicLive(0)).toEqual({ players: null });
  });

  it('caché de 10 s', () => {
    vi.useFakeTimers();
    let calls = 0;
    const f = cached(() => ++calls, 10_000);
    expect(f()).toBe(1);
    expect(f()).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(f()).toBe(2);
    vi.useRealTimers();
  });
});
