// Blue-Noise-Schwellwertmatrix (void-and-cluster, Ulichney 1993) – eigene Implementierung, keine Fremddaten.
// Ergebnis: Schwellwerte (Rang + 0,5) / n auf einem n×n-Torus, deterministisch.

import { mulberry32 } from '../../src/effects/random';

const cache = new Map<number, Float32Array>();

export function blueNoise(size = 64, sigma = 1.5): Float32Array {
  const hit = cache.get(size);
  if (hit) return hit;
  const n = size * size;
  // Gauß-Kern auf dem Torus
  const r = Math.ceil(3 * sigma);
  const kernel: { dx: number; dy: number; w: number }[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      kernel.push({ dx, dy, w: Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)) });
  const energy = new Float64Array(n);
  const bits = new Uint8Array(n);
  const add = (i: number, sign: number) => {
    const x = i % size;
    const y = Math.floor(i / size);
    for (const k of kernel) {
      const j = ((y + k.dy + size) % size) * size + ((x + k.dx + size) % size);
      energy[j] = (energy[j] ?? 0) + sign * k.w;
    }
  };
  const extreme = (want: number, max: boolean) => {
    let best = -1;
    let bv = max ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      if (bits[i] !== want) continue;
      const e = energy[i] ?? 0;
      if (max ? e > bv : e < bv) {
        bv = e;
        best = i;
      }
    }
    return best;
  };
  // Startmuster: 10 % zufällig, dann gleichmäßig verteilen (dichtesten Cluster in die größte Lücke verschieben)
  const rand = mulberry32(7);
  const initial = Math.floor(n / 10);
  for (let k = 0; k < initial; k++) {
    let i = Math.floor(rand() * n);
    while (bits[i]) i = (i + 1) % n;
    bits[i] = 1;
    add(i, 1);
  }
  for (let iter = 0; iter < n; iter++) {
    const cluster = extreme(1, true);
    bits[cluster] = 0;
    add(cluster, -1);
    const voidIdx = extreme(0, false);
    if (voidIdx === cluster) {
      bits[cluster] = 1;
      add(cluster, 1);
      break;
    }
    bits[voidIdx] = 1;
    add(voidIdx, 1);
  }
  const rank = new Int32Array(n);
  const start = bits.slice();
  const startEnergy = energy.slice();
  // Phase 1: Ränge der Startpunkte absteigend (dichtesten Cluster zuerst entfernen)
  let ones = initial;
  while (ones > 0) {
    const c = extreme(1, true);
    bits[c] = 0;
    add(c, -1);
    ones--;
    rank[c] = ones;
  }
  // Phase 2: ab dem Startmuster aufsteigend in die größte Lücke einfügen
  bits.set(start);
  energy.set(startEnergy);
  for (let k = initial; k < n; k++) {
    const v = extreme(0, false);
    bits[v] = 1;
    add(v, 1);
    rank[v] = k;
  }
  const out = Float32Array.from(rank, (v) => (v + 0.5) / n);
  cache.set(size, out);
  return out;
}

const BAYER2 = [0, 2, 3, 1];

/** Bayer-Matrix der Größe 2^k (Schwellwerte 0..1) */
export function bayer(size: number): Float32Array {
  let m = BAYER2.slice();
  let s = 2;
  while (s < size) {
    const next = new Array<number>(s * 2 * s * 2);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = (m[y * s + x] ?? 0) * 4;
        next[y * 2 * s + x] = v;
        next[y * 2 * s + x + s] = v + 2;
        next[(y + s) * 2 * s + x] = v + 3;
        next[(y + s) * 2 * s + x + s] = v + 1;
      }
    m = next;
    s *= 2;
  }
  return Float32Array.from(m, (v) => (v + 0.5) / (s * s));
}
