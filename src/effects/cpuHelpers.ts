// Hilfen für CPU-Effekte (effect.worker.ts): Farbräume, Messraster auf der Leinwand, weiches Rauschen, Linien zeichnen.
// Alles hängt nur von Leinwand-Koordinaten und Seed ab – Vorschau und Export ergeben dasselbe Bild.

import type { CpuEffectContext } from './cpuApi';
import { randCell } from './random';

export const decodeSrgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const encodeSrgb = (l: number): number =>
  l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055;

export function oklabFromLinear(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function linearFromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** sRGB-Farbe eines Parameters (0..1) → linear */
export function paramColor(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length < 3) return fallback.map(decodeSrgb) as [number, number, number];
  return [decodeSrgb(Number(v[0])), decodeSrgb(Number(v[1])), decodeSrgb(Number(v[2]))];
}

/**
 * Messraster über der ganzen Leinwand mit fester langer Kante (unabhängig von der Render-Auflösung): Oklab-Mittel und
 * Deckung je Zelle. gs = Rasterzellen je Render-px.
 */
export type CanvasGrid = { GW: number; GH: number; gs: number; lab: Float32Array; alpha: Float32Array };

export function measureGrid(img: Float32Array, ctx: CpuEffectContext, longEdge: number): CanvasGrid {
  const { width: W, height: H } = ctx;
  const [cw, ch] = ctx.canvasSize;
  const [ox, oy] = ctx.origin;
  // nie feiner als das gerenderte Bild (sonst bleiben Zellen leer)
  const gs = Math.min(longEdge, Math.max(cw, ch)) / Math.max(cw, ch);
  const GW = Math.max(1, Math.round(cw * gs));
  const GH = Math.max(1, Math.round(ch * gs));
  const acc = new Float64Array(GW * GH * 4);
  const cnt = new Float64Array(GW * GH);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(GH - 1, Math.max(0, Math.floor((y + oy + 0.5) * gs)));
    for (let x = 0; x < W; x++) {
      const gx = Math.min(GW - 1, Math.max(0, Math.floor((x + ox + 0.5) * gs)));
      const i = (y * W + x) * 4;
      const a = img[i + 3] ?? 0;
      const g = gy * GW + gx;
      cnt[g] = (cnt[g] ?? 0) + 1;
      acc[g * 4 + 3] = (acc[g * 4 + 3] ?? 0) + a;
      if (a <= 0) continue;
      // Farbe (vormultipliziert) aufsummieren, Oklab erst aus dem Mittel
      acc[g * 4] = (acc[g * 4] ?? 0) + (img[i] ?? 0);
      acc[g * 4 + 1] = (acc[g * 4 + 1] ?? 0) + (img[i + 1] ?? 0);
      acc[g * 4 + 2] = (acc[g * 4 + 2] ?? 0) + (img[i + 2] ?? 0);
    }
  }
  const lab = new Float32Array(GW * GH * 3);
  const alpha = new Float32Array(GW * GH);
  for (let g = 0; g < GW * GH; g++) {
    const a = acc[g * 4 + 3] ?? 0;
    alpha[g] = (cnt[g] ?? 0) > 0 ? a / (cnt[g] ?? 1) : 0;
    const d = a > 0 ? a : 1;
    const c = oklabFromLinear((acc[g * 4] ?? 0) / d, (acc[g * 4 + 1] ?? 0) / d, (acc[g * 4 + 2] ?? 0) / d);
    lab[g * 3] = a > 0 ? c[0] : 1;
    lab[g * 3 + 1] = a > 0 ? c[1] : 0;
    lab[g * 3 + 2] = a > 0 ? c[2] : 0;
  }
  // leere Zellen (nur durch Rundung am Rand) vom Nachbarn übernehmen
  for (let g = 0; g < GW * GH; g++)
    if ((cnt[g] ?? 0) === 0 && g > 0) {
      lab[g * 3] = lab[(g - 1) * 3] ?? 1;
      lab[g * 3 + 1] = lab[(g - 1) * 3 + 1] ?? 0;
      lab[g * 3 + 2] = lab[(g - 1) * 3 + 2] ?? 0;
      alpha[g] = alpha[g - 1] ?? 0;
    }
  return { GW, GH, gs, lab, alpha };
}

/** Weiches Wertrauschen 0..1 an einer Leinwandposition (Zellgröße in Leinwand-px). */
export function valueNoise(x: number, y: number, cell: number, seed: number, k = 0): number {
  const qx = x / cell;
  const qy = y / cell;
  const ix = Math.floor(qx);
  const iy = Math.floor(qy);
  const fx = qx - ix;
  const fy = qy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = randCell(ix, iy, seed, k);
  const b = randCell(ix + 1, iy, seed, k);
  const c = randCell(ix, iy + 1, seed, k);
  const d = randCell(ix + 1, iy + 1, seed, k);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Zeichnet eine geglättete Linie (Kapsel, Breite w Render-px) als Deckung 0..1 in cov (W·H, Maximum). Antialiasing über
 * den Abstand zur Strecke.
 */
export function strokeSegment(
  cov: Float32Array,
  W: number,
  H: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  opacity = 1,
  /** optional: Farbe der Linie in Farbpuffer schreiben (dort, wo diese Linie die größte Deckung hat) */
  color?: { r: Float32Array; g: Float32Array; b: Float32Array; rgb: readonly [number, number, number] },
): void {
  const r = w / 2;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r + 1));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-9;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d = Math.sqrt(ex * ex + ey * ey);
      // Linien unter 1 px: Deckung proportional zur Breite
      const v = Math.max(0, Math.min(1, r + 0.5 - d)) * Math.min(1, w) * opacity;
      const i = y * W + x;
      if (v > (cov[i] ?? 0)) {
        cov[i] = v;
        if (color) {
          color.r[i] = color.rgb[0];
          color.g[i] = color.rgb[1];
          color.b[i] = color.rgb[2];
        }
      }
    }
}
