// Palette aus einem Bild gewinnen (Spec „Effekte“ posterize-palette: Palettenquelle Bild/Referenzbild):
// k-means in Oklab (wahrnehmungsnah), deterministisch (k-means++-Start mit festem Seed).

import type { Rgb } from './manifest';
import { mulberry32 } from './random';

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);

function toOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, enc(v))) * 1000) / 1000) as Rgb;
}

/**
 * k Palettenfarben (sRGB 0..1, nach Helligkeit sortiert) aus RGBA-8-Bit-Pixeln (z. B. ImageData.data).
 * Höchstens maxSamples Pixel werden gleichmäßig ausgewählt; transparente Pixel zählen nicht.
 */
export function extractPalette(rgba: Uint8ClampedArray, k: number, maxSamples = 20000, seed = 1): Rgb[] {
  const n = rgba.length / 4;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const list: number[] = [];
  for (let i = 0; i < n; i += step) {
    if ((rgba[i * 4 + 3] ?? 0) < 128) continue;
    list.push(
      ...toOklab(
        lin((rgba[i * 4] ?? 0) / 255),
        lin((rgba[i * 4 + 1] ?? 0) / 255),
        lin((rgba[i * 4 + 2] ?? 0) / 255),
      ),
    );
  }
  const pts = Float64Array.from(list);
  const count = pts.length / 3;
  if (count === 0) return [[0, 0, 0]];
  const kk = Math.max(1, Math.min(k, count));
  const rand = mulberry32(seed);
  const centers = new Float64Array(kk * 3);
  const at = (a: Float64Array, i: number, c: number) => a[i * 3 + c] ?? 0;
  const d2 = (i: number, c: number) =>
    (at(pts, i, 0) - at(centers, c, 0)) ** 2 +
    (at(pts, i, 1) - at(centers, c, 1)) ** 2 +
    (at(pts, i, 2) - at(centers, c, 2)) ** 2;
  const setCenter = (c: number, i: number) => {
    for (let j = 0; j < 3; j++) centers[c * 3 + j] = at(pts, i, j);
  };
  // k-means++
  setCenter(0, Math.floor(rand() * count));
  const dist = new Float64Array(count);
  for (let i = 0; i < count; i++) dist[i] = d2(i, 0);
  for (let c = 1; c < kk; c++) {
    let total = 0;
    for (const v of dist) total += v;
    let r = rand() * total;
    let idx = 0;
    for (; idx < count - 1; idx++) {
      r -= dist[idx] ?? 0;
      if (r <= 0) break;
    }
    setCenter(c, idx);
    for (let i = 0; i < count; i++) dist[i] = Math.min(dist[i] ?? 0, d2(i, c));
  }
  // Lloyd-Iterationen
  const assign = new Int32Array(count).fill(-1);
  for (let iter = 0; iter < 30; iter++) {
    let changed = false;
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = d2(i, c);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const sums = new Float64Array(kk * 4);
    for (let i = 0; i < count; i++) {
      const c = assign[i] ?? 0;
      for (let j = 0; j < 3; j++) sums[c * 4 + j] = (sums[c * 4 + j] ?? 0) + at(pts, i, j);
      sums[c * 4 + 3] = (sums[c * 4 + 3] ?? 0) + 1;
    }
    for (let c = 0; c < kk; c++) {
      const m = sums[c * 4 + 3] ?? 0;
      if (m > 0) for (let j = 0; j < 3; j++) centers[c * 3 + j] = (sums[c * 4 + j] ?? 0) / m;
    }
    if (!changed) break;
  }
  const out: [number, number, number][] = [];
  for (let c = 0; c < kk; c++) out.push([at(centers, c, 0), at(centers, c, 1), at(centers, c, 2)]);
  return out.sort((a, b) => a[0] - b[0]).map(fromOklab);
}
