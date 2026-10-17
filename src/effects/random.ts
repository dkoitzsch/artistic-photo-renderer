// Deterministischer Zufall für Effekte auf der CPU (Worker) und für Tests – identisch zu den WGSL-Funktionen
// pcg3 / rand_cell im Effekt-Vorspann (src/effects/prelude.ts). Gleicher Seed = gleiches Ergebnis.

const u32 = (x: number) => x >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;

/** PCG3D-Hash (Jarzynski & Olano 2020) auf 32-Bit-Ganzzahlen. */
export function pcg3(x0: number, y0: number, z0: number): [number, number, number] {
  let x = u32(mul(x0, 1664525) + 1013904223);
  let y = u32(mul(y0, 1664525) + 1013904223);
  let z = u32(mul(z0, 1664525) + 1013904223);
  x = u32(x + mul(y, z));
  y = u32(y + mul(z, x));
  z = u32(z + mul(x, y));
  x = u32(x ^ (x >>> 16));
  y = u32(y ^ (y >>> 16));
  z = u32(z ^ (z >>> 16));
  x = u32(x + mul(y, z));
  y = u32(y + mul(z, x));
  z = u32(z + mul(x, y));
  return [x, y, z];
}

/** Zufall 0..1 je Leinwandzelle, Seed und Kanal (wie rand_cell im Shader). */
export function randCell(cx: number, cy: number, seed: number, k = 0): number {
  const [x] = pcg3(cx | 0, cy | 0, u32(mul(seed >>> 0, 747796405) + k));
  return (x >>> 8) / 16777216;
}

/** Fortlaufender Zufallsgenerator (mulberry32) für Punktmengen u. Ä.; liefert 0..1. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
