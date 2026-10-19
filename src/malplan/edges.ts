// Kanten-Karte (Spec „Effekte“ 7.5): Grenzen zwischen Malplan-Flächen werden nach Kontrast und Breite des Übergangs
// eingeteilt – hart (schmaler Übergang), weich (breiter Übergang), verloren (kaum Kontrast). Gemessen je Grenzpixel:
// Kontrast = Helligkeitsunterschied der beiden Flächen (Oklab L), Breite = Kontrast / größter Helligkeitsgradient im
// leicht geglätteten Bild (px). Rein, getestet; die Einteilung mit den Schwellen der Oberfläche macht classify().

import type { Analysis } from './analysis';

export type EdgeMeasures = {
  /** je Pixel: Kontrast 0…1 (0 = kein Grenzpixel) */
  contrast: Float32Array;
  /** je Pixel: Breite des Übergangs in px (nur an Grenzpixeln sinnvoll) */
  width: Float32Array;
};

export type EdgeClass = 0 | 1 | 2 | 3; // 0 keine, 1 hart, 2 weich, 3 verloren

/** Helligkeit (Oklab L) 3 × 3 geglättet */
export function blurL(L: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          s += (L[yy * w + xx] ?? 0) * k;
          n += k;
        }
      out[y * w + x] = s / n;
    }
  return out;
}

/** Bilinear gelesene Helligkeit */
function sample(L: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = Math.min(w - 1.001, Math.max(0, x));
  const fy = Math.min(h - 1.001, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * w + x0;
  const a = (L[i] ?? 0) * (1 - tx) + (L[i + 1] ?? 0) * tx;
  const b = (L[i + w] ?? 0) * (1 - tx) + (L[i + w + 1] ?? 0) * tx;
  return a * (1 - ty) + b * ty;
}

/** Reichweite des Querprofils (px) */
const PROFILE = 6;

/**
 * Misst Kontrast und Übergangsbreite an allen Flächengrenzen. L: Helligkeit des Bildes (geglättet).
 * Kontrast = Helligkeitsunterschied der beiden Flächen (für „verloren“). Breite aus dem Querprofil quer zur Kante
 * (Richtung des Gradienten): Stufe über ±6 px geteilt durch den steilsten Gradienten auf dieser Linie.
 */
export function measureEdges(a: Analysis, L: Float32Array): EdgeMeasures {
  const { width: w, height: h, labels, regions } = a;
  const contrast = new Float32Array(w * h);
  const width = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i] ?? 0;
      let other = -1;
      if (x + 1 < w && labels[i + 1] !== l) other = labels[i + 1] ?? -1;
      else if (y + 1 < h && labels[i + w] !== l) other = labels[i + w] ?? -1;
      if (other < 0) continue;
      const c = Math.abs((regions[l]?.lab[0] ?? 0) - (regions[other]?.lab[0] ?? 0));
      contrast[i] = Math.max(c, 1e-4);
      // Querrichtung: Gradient an der Grenze (zwischen den beiden Pixeln)
      const cx = x + 0.5;
      const cy = y + 0.5;
      const gx = sample(L, w, h, cx + 1, cy) - sample(L, w, h, cx - 1, cy);
      const gy = sample(L, w, h, cx, cy + 1) - sample(L, w, h, cx, cy - 1);
      const gl = Math.hypot(gx, gy);
      if (gl < 1e-6) {
        width[i] = 999;
        continue;
      }
      const nx = gx / gl;
      const ny = gy / gl;
      const step = Math.abs(
        sample(L, w, h, cx + nx * PROFILE, cy + ny * PROFILE) -
          sample(L, w, h, cx - nx * PROFILE, cy - ny * PROFILE),
      );
      let gmax = 0;
      let prev = sample(L, w, h, cx - nx * PROFILE, cy - ny * PROFILE);
      for (let k = -PROFILE + 0.5; k <= PROFILE; k += 0.5) {
        const v = sample(L, w, h, cx + nx * k, cy + ny * k);
        gmax = Math.max(gmax, Math.abs(v - prev) / 0.5);
        prev = v;
      }
      width[i] = gmax > 1e-6 ? step / gmax : 999;
    }
  // entlang der Grenze glätten: Median der Breiten benachbarter Grenzpixel (5 × 5), damit Abschnitte einheitlich sind
  const smoothed = new Float32Array(w * h);
  const near: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!(contrast[i] ?? 0)) continue;
      near.length = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (contrast[j]) near.push(width[j] ?? 999);
        }
      near.sort((p, q) => p - q);
      smoothed[i] = near[near.length >> 1] ?? width[i] ?? 999;
    }
  return { contrast, width: smoothed };
}

/**
 * Einteilung je Pixel: verloren, wenn der Kontrast unter lost liegt; hart, wenn der Übergang höchstens hard px breit
 * ist; sonst weich.
 */
export function classify(m: EdgeMeasures, lost: number, hard: number): Uint8Array {
  const out = new Uint8Array(m.contrast.length);
  for (let i = 0; i < out.length; i++) {
    const c = m.contrast[i] ?? 0;
    if (c <= 0) continue;
    out[i] = c < lost ? 3 : (m.width[i] ?? 999) <= hard ? 1 : 2;
  }
  return out;
}
