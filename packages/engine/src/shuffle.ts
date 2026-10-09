/**
 * PRNG determinista (xoshiro256**) y baraja.
 *
 * Por qué no `Math.random`: necesitamos que `seed + log` reconstruya cualquier
 * partida (replays, depuración, validación de clientes).
 *
 * Referencia: https://prng.di.unimi.it/xoshiro256starstar.c (dominio público)
 */

export interface Rng {
  /** Entero en [0, 2^32). */
  next(): number;
  /** Número en [0, 1). */
  nextFloat(): number;
  /** Entero en [min, max] (ambos inclusive). */
  nextInt(min: number, max: number): number;
}

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & 0xffffffffffffffffn;
}

/**
 * Crea un Rng a partir de una semilla. La semilla puede ser cualquier string;
 * la pasamos por un hash no criptográfico para obtener 4 BigInts de 64 bits.
 */
export function rngFromSeed(seed: string): Rng {
  // FNV-1a de 64 bits manual (rápido, sin dependencias).
  const MASK = 0xffffffffffffffffn;
  const parts: bigint[] = [];
  for (let i = 0; i < 4; i++) {
    let hash = 0xcbf29ce484222325n;
    const slice = `${seed}::part${i}`;
    for (let j = 0; j < slice.length; j++) {
      hash ^= BigInt(slice.charCodeAt(j));
      hash = (hash * 0x100000001b3n) & MASK;
    }
    parts.push(hash);
  }
  const state: bigint[] = parts;

  const next = (): number => {
    const result = (rotl((state[1]! * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (state[1]! << 17n) & MASK;
    state[2]! ^= state[0]!;
    state[3]! ^= state[1]!;
    state[1]! ^= state[2]!;
    state[0]! ^= state[3]!;
    state[2]! ^= t;
    state[3]! = rotl(state[3]!, 45n);
    // Map a [0, 2^32) para devolver un number de JS.
    return Number(result >> 32n);
  };

  return {
    next,
    nextFloat: () => next() / 0x1_0000_0000,
    nextInt: (min, max) => min + Math.floor(((next() / 0x1_0000_0000) * (max - min + 1))),
  };
}

/**
 * Fisher–Yates con el Rng dado. NO clona el array.
 */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
