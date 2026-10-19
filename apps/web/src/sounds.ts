/**
 * S3-08: sonidos de la mesa, sintetizados con Web Audio (sin ficheros).
 *
 *  - `card`: carta jugada (un golpe seco, como una carta sobre el tapete).
 *  - `cante`: dos notas ascendentes.
 *  - `turn`: campanita suave cuando te toca.
 *
 * El silencio se guarda en localStorage (`guinote:muted`). El
 * AudioContext se crea la primera vez que hace falta; los navegadores
 * solo lo dejan sonar tras un gesto del usuario, y en la mesa siempre
 * lo hay (pulsar "Jugar", jugar una carta).
 */
import { useSyncExternalStore } from 'react';

export type SoundName = 'card' | 'cante' | 'turn';

const MUTED_KEY = 'guinote:muted';

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = typeof window !== 'undefined' ? readMuted() : true;
const listeners = new Set<() => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTED_KEY, value ? '1' : '0');
  } catch {
    // localStorage no disponible: el silencio dura solo esta sesión.
  }
  for (const l of listeners) l();
}

/** Hook: `[muted, setMuted]` sincronizado entre componentes. */
export function useMuted(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => muted,
    () => true,
  );
  return [value, setMuted];
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Nota con envolvente rápida (ataque corto, caída exponencial). */
function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Buffer de ruido blanco reutilizable (1 s). */
let noiseBuf: AudioBuffer | null = null;
function noise(ac: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
  const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

/** Variación aleatoria ±`amount` (fracción) para que no suene a máquina. */
function vary(value: number, amount: number): number {
  return value * (1 + (Math.random() * 2 - 1) * amount);
}

/**
 * Carta que cae sobre el tapete, en tres capas:
 *  1. "Fsss": el aire de la carta al deslizarse (ruido en banda que baja
 *     de agudo a medio, ~90 ms, suave).
 *  2. "Clac": el canto de la carta al tocar la mesa (ruido corto y seco,
 *     ~35 ms, con más cuerpo en medios).
 *  3. "Tump": el tablero de madera debajo del paño (tono grave que cae,
 *     ~70 ms, muy bajito).
 * Cada vez varían un poco el tono y los filtros.
 */
export function cardSound(ac: BaseAudioContext, start: number): void {
  const buf = noise(ac);
  const out = ac.createGain();
  out.gain.value = 0.9;
  out.connect(ac.destination);

  // 1. Deslizamiento.
  const swish = ac.createBufferSource();
  swish.buffer = buf;
  const swishBand = ac.createBiquadFilter();
  swishBand.type = 'bandpass';
  swishBand.Q.value = 1.1;
  swishBand.frequency.setValueAtTime(vary(5200, 0.12), start);
  swishBand.frequency.exponentialRampToValueAtTime(vary(1700, 0.12), start + 0.09);
  const swishGain = ac.createGain();
  swishGain.gain.setValueAtTime(0.0001, start);
  swishGain.gain.exponentialRampToValueAtTime(0.16, start + 0.045);
  swishGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.095);
  swish.connect(swishBand).connect(swishGain).connect(out);
  swish.start(start, Math.random() * 0.5, 0.12);

  // 2. Golpe del canto, justo al acabar el deslizamiento.
  const hit = start + 0.075;
  const slap = ac.createBufferSource();
  slap.buffer = buf;
  const slapHigh = ac.createBiquadFilter();
  slapHigh.type = 'highpass';
  slapHigh.frequency.value = 350;
  const slapLow = ac.createBiquadFilter();
  slapLow.type = 'lowpass';
  slapLow.frequency.setValueAtTime(vary(4200, 0.15), hit);
  slapLow.frequency.exponentialRampToValueAtTime(900, hit + 0.035);
  const slapGain = ac.createGain();
  slapGain.gain.setValueAtTime(0.0001, hit);
  slapGain.gain.exponentialRampToValueAtTime(0.55, hit + 0.002);
  slapGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.045);
  slap.connect(slapHigh).connect(slapLow).connect(slapGain).connect(out);
  slap.start(hit, Math.random() * 0.5, 0.06);

  // 3. Cuerpo de la mesa.
  const body = ac.createOscillator();
  body.type = 'sine';
  const f0 = vary(150, 0.1);
  body.frequency.setValueAtTime(f0, hit);
  body.frequency.exponentialRampToValueAtTime(f0 * 0.55, hit + 0.07);
  const bodyGain = ac.createGain();
  bodyGain.gain.setValueAtTime(0.0001, hit);
  bodyGain.gain.exponentialRampToValueAtTime(0.22, hit + 0.004);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, hit + 0.08);
  body.connect(bodyGain).connect(out);
  body.start(hit);
  body.stop(hit + 0.1);
}

export function playSound(name: SoundName): void {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  const now = ac.currentTime + 0.01;
  switch (name) {
    case 'card':
      cardSound(ac, now);
      break;
    case 'cante':
      tone(ac, 659.25, now, 0.22, 0.18, 'triangle'); // Mi
      tone(ac, 987.77, now + 0.13, 0.38, 0.16, 'triangle'); // Si
      break;
    case 'turn':
      tone(ac, 1318.5, now, 0.35, 0.07);
      tone(ac, 2637, now, 0.18, 0.02);
      break;
  }
}
