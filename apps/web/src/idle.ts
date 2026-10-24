/**
 * ¿Hay alguien delante? Las consultas automáticas (jugadores conectados,
 * avisos de amigos) solo se hacen con la pestaña visible y si ha habido
 * actividad en los últimos 10 minutos. Así una pestaña olvidada no mantiene
 * despierto el servidor (que se apaga solo cuando no recibe peticiones).
 */
export const IDLE_AFTER_MS = 10 * 60_000;

let lastActivity = Date.now();
const mark = () => {
  lastActivity = Date.now();
};
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') mark();
  });
}

export function shouldPoll(now: number = Date.now()): boolean {
  return document.visibilityState === 'visible' && now - lastActivity < IDLE_AFTER_MS;
}
