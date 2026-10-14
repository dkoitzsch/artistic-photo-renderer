// Aufteilung einer Tiefenkarte (0 = nah … 1 = fern) in N Ebenen: Histogramm, Grenzen per Quantil oder k-Means.

export const MIN_LAYERS = 2;
export const MAX_LAYERS = 8;

/** Histogramm mit `bins` Klassen über 0…1. */
export function histogram(depth: ArrayLike<number>, bins = 256): Float64Array {
  const h = new Float64Array(bins);
  for (let i = 0; i < depth.length; i++) {
    const v = Math.min(1, Math.max(0, depth[i] ?? 0));
    h[Math.min(bins - 1, Math.floor(v * bins))] = (h[Math.min(bins - 1, Math.floor(v * bins))] ?? 0) + 1;
  }
  return h;
}

/**
 * Grenzen [0, b1, …, b(n−1), 1] so, dass jede Ebene etwa gleich viele Pixel hat.
 */
export function quantileBoundaries(hist: Float64Array, n: number): number[] {
  const bins = hist.length;
  const total = hist.reduce((a, b) => a + b, 0);
  const out = [0];
  let acc = 0;
  let k = 1;
  for (let i = 0; i < bins && k < n; i++) {
    acc += hist[i] ?? 0;
    while (k < n && acc >= (total * k) / n) {
      out.push((i + 1) / bins);
      k++;
    }
  }
  while (out.length < n) out.push(1);
  out.push(1);
  return enforceGap(out);
}

/** 1D-k-Means auf dem Histogramm; Grenzen liegen mittig zwischen den sortierten Zentren. */
export function kmeansBoundaries(hist: Float64Array, n: number, iterations = 30): number[] {
  const bins = hist.length;
  const q = quantileBoundaries(hist, n);
  // Start: Mittelpunkte der Quantil-Ebenen
  let centers = Array.from({ length: n }, (_, k) => ((q[k] ?? 0) + (q[k + 1] ?? 1)) / 2);
  for (let it = 0; it < iterations; it++) {
    const sum = new Float64Array(n);
    const cnt = new Float64Array(n);
    for (let i = 0; i < bins; i++) {
      const w = hist[i] ?? 0;
      if (!w) continue;
      const v = (i + 0.5) / bins;
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, k) => {
        const d = Math.abs(v - c);
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      sum[best] = (sum[best] ?? 0) + v * w;
      cnt[best] = (cnt[best] ?? 0) + w;
    }
    const next = centers.map((c, k) => ((cnt[k] ?? 0) > 0 ? (sum[k] ?? 0) / (cnt[k] ?? 1) : c));
    const moved = next.some((c, k) => Math.abs(c - (centers[k] ?? 0)) > 1e-6);
    centers = next.sort((a, b) => a - b);
    if (!moved) break;
  }
  const out = [0];
  for (let k = 0; k < n - 1; k++) out.push(((centers[k] ?? 0) + (centers[k + 1] ?? 0)) / 2);
  out.push(1);
  return enforceGap(out);
}

/** Grenzen streng aufsteigend mit Mindestabstand halten (für Regler und leere Ebenen). */
export function enforceGap(b: number[], gap = 0.01): number[] {
  const out = b.slice();
  out[0] = 0;
  out[out.length - 1] = 1;
  for (let i = 1; i < out.length - 1; i++)
    out[i] = Math.max((out[i - 1] ?? 0) + gap, Math.min(out[i] ?? 0, 1 - gap * (out.length - 1 - i)));
  return out;
}

/** Verschiebt die Grenze i (1 … n−1) und hält die Reihenfolge ein. */
export function moveBoundary(b: number[], i: number, value: number, gap = 0.01): number[] {
  if (i <= 0 || i >= b.length - 1) return b;
  const out = b.slice();
  out[i] = Math.min((out[i + 1] ?? 1) - gap, Math.max((out[i - 1] ?? 0) + gap, value));
  return out;
}

export type DepthPreset = 'atmosphere' | 'blur' | 'none';

/**
 * Startwerte je Ebene (Rang 0 = nächste … n−1 = fernste): Unschärfe und Dunst steigen mit der Entfernung.
 */
export function presetValues(
  preset: DepthPreset,
  rank: number,
  n: number,
  maxBlur: number,
  maxHaze: number,
): { blur: number; haze: number } {
  if (preset === 'none' || n < 2) return { blur: 0, haze: 0 };
  const t = rank / (n - 1);
  const blur = Math.round(maxBlur * Math.pow(t, 1.3) * 10) / 10;
  const haze = preset === 'atmosphere' ? Math.round(maxHaze * Math.pow(t, 1.1)) : 0;
  return { blur, haze };
}
