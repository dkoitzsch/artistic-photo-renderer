// Stil übertragen (klassisch, ohne Modell): Bild und Stilbild in Oklab.
//  1. Farben: Histogrammangleich je Kanal (L, a, b) an das Stilbild (Reinhard et al. 2001 erweitert auf Histogramme).
//  2. Struktur: Laplace-Pyramide der Helligkeit; je Band werden die Koeffizienten an die Verteilung des Stilbildes im
//     entsprechenden Band angeglichen (Heeger & Bergen 1995) – grobe und feine Kontraste wie im Stil.
//  3. Textur einweben: die feinsten Bänder des Stilbildes, ortsfest gekachelt (gespiegelt), aufaddiert.
// Ohne Stilbild bleibt das Bild unverändert.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { linearFromOklab, oklabFromLinear } from '../../src/effects/cpuHelpers';

type Plane = { d: Float32Array; w: number; h: number };

function toOklab(
  src: Float32Array,
  w: number,
  h: number,
): { L: Plane; A: Plane; B: Plane; alpha: Float32Array } {
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = src[i * 4 + 3] ?? 0;
    alpha[i] = a;
    const d = a > 0 ? a : 1;
    const [l, aa, bb] = oklabFromLinear(
      (src[i * 4] ?? 0) / d,
      (src[i * 4 + 1] ?? 0) / d,
      (src[i * 4 + 2] ?? 0) / d,
    );
    L[i] = l;
    A[i] = aa;
    B[i] = bb;
  }
  return { L: { d: L, w, h }, A: { d: A, w, h }, B: { d: B, w, h }, alpha };
}

/** Halbe Größe mit [1 2 1]-Glättung */
function down(p: Plane): Plane {
  const w = Math.max(1, Math.ceil(p.w / 2));
  const h = Math.max(1, Math.ceil(p.h / 2));
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) =>
    p.d[Math.min(p.h - 1, Math.max(0, y)) * p.w + Math.min(p.w - 1, Math.max(0, x))] ?? 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x * 2;
      const sy = y * 2;
      let s = 0;
      for (let dy = -1; dy <= 2; dy++)
        for (let dx = -1; dx <= 2; dx++) {
          const wx = dx === -1 || dx === 2 ? 1 : 3;
          const wy = dy === -1 || dy === 2 ? 1 : 3;
          s += at(sx + dx, sy + dy) * wx * wy;
        }
      out[y * w + x] = s / 64;
    }
  return { d: out, w, h };
}

/** Bilinear auf w × h */
function up(p: Plane, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, ((y + 0.5) * p.h) / h - 0.5);
    const y0 = Math.min(p.h - 1, Math.floor(fy));
    const y1 = Math.min(p.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, ((x + 0.5) * p.w) / w - 0.5);
      const x0 = Math.min(p.w - 1, Math.floor(fx));
      const x1 = Math.min(p.w - 1, x0 + 1);
      const tx = fx - x0;
      const a = (p.d[y0 * p.w + x0] ?? 0) * (1 - tx) + (p.d[y0 * p.w + x1] ?? 0) * tx;
      const b = (p.d[y1 * p.w + x0] ?? 0) * (1 - tx) + (p.d[y1 * p.w + x1] ?? 0) * tx;
      out[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Laplace-Pyramide: Bänder (fein → grob) und Rest (grob) */
function laplacian(p: Plane, levels: number): { bands: Plane[]; rest: Plane } {
  const bands: Plane[] = [];
  let cur = p;
  for (let i = 0; i < levels; i++) {
    const lo = down(cur);
    const upLo = up(lo, cur.w, cur.h);
    const band = new Float32Array(cur.w * cur.h);
    for (let k = 0; k < band.length; k++) band[k] = (cur.d[k] ?? 0) - (upLo[k] ?? 0);
    bands.push({ d: band, w: cur.w, h: cur.h });
    cur = lo;
  }
  return { bands, rest: cur };
}

/** Quantile-Abbildung src → Verteilung ref (Histogramm mit bins Stufen, Werte in [lo, hi]) */
function matchHistogram(src: Float32Array, ref: Float32Array, amount: number): void {
  if (amount <= 0 || src.length === 0 || ref.length === 0) return;
  const bins = 1024;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of src) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (const v of ref) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo || 1;
  const cdf = (arr: Float32Array) => {
    const h = new Float64Array(bins);
    for (const v of arr) {
      const b = Math.min(bins - 1, Math.floor(((v - lo) / span) * bins));
      h[b] = (h[b] ?? 0) + 1;
    }
    let s = 0;
    for (let i = 0; i < bins; i++) {
      s += h[i] ?? 0;
      h[i] = s / arr.length;
    }
    return h;
  };
  const cs = cdf(src);
  const cr = cdf(ref);
  // Abbildung je Stufe: Wert der Referenz mit gleichem Quantil
  const map = new Float32Array(bins);
  let j = 0;
  for (let i = 0; i < bins; i++) {
    const q = cs[i] ?? 0;
    while (j < bins - 1 && (cr[j] ?? 0) < q) j++;
    map[i] = lo + ((j + 0.5) / bins) * span;
  }
  for (let k = 0; k < src.length; k++) {
    const v = src[k] ?? 0;
    const m = map[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))] ?? v;
    src[k] = v + (m - v) * amount;
  }
}

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const style = ctx.imageB();
    if (!style) return img.slice();
    const colors = Number(p.colors) / 100;
    const texture = Number(p.texture) / 100;
    const weave = Number(p.weave) / 100;
    const keepLight = Number(p.keepLight) / 100;
    const content = toOklab(img, W, H);
    const st = toOklab(style.data, style.width, style.height);
    ctx.progress(0.1);

    // Ebenen so wählen, dass das gröbste Band etwa 1/32 der kurzen Kante entspricht
    const levels = Math.max(1, Math.min(7, Math.round(Math.log2(Math.min(W, H) / 32))));
    const styleLevels = Math.max(
      1,
      Math.min(levels, Math.round(Math.log2(Math.min(style.width, style.height) / 16))),
    );

    // 1. Struktur: Bänder der Helligkeit angleichen
    const origL = content.L.d.slice();
    const pyr = laplacian(content.L, levels);
    const spyr = laplacian(st.L, styleLevels);
    pyr.bands.forEach((band, i) => {
      // passendes Band des Stilbildes (relativ zur Bildgröße: gleiche Stufe, sonst das gröbste vorhandene)
      const ref = spyr.bands[Math.min(i, spyr.bands.length - 1)];
      if (ref) matchHistogram(band.d, ref.d, texture);
      ctx.progress(0.1 + (0.4 * (i + 1)) / pyr.bands.length);
    });
    // Rest (grobe Helligkeit) an die Helligkeitsverteilung des Stils
    matchHistogram(pyr.rest.d, spyr.rest.d, colors * (1 - keepLight));
    // Rekonstruktion
    let cur = pyr.rest;
    for (let i = pyr.bands.length - 1; i >= 0; i--) {
      const band = pyr.bands[i];
      if (!band) continue;
      const u = up(cur, band.w, band.h);
      for (let k = 0; k < u.length; k++) u[k] = (u[k] ?? 0) + (band.d[k] ?? 0);
      cur = { d: u, w: band.w, h: band.h };
    }
    const L = cur.d;
    ctx.progress(0.6);

    // 2. Farben (a, b) angleichen
    matchHistogram(content.A.d, st.A.d, colors);
    matchHistogram(content.B.d, st.B.d, colors);

    // 3. Textur einweben: feinste zwei Bänder des Stilbildes, gekachelt (gespiegelt) in Leinwand-Koordinaten
    if (weave > 0 && spyr.bands.length > 0) {
      const b0 = spyr.bands[0];
      const b1 = spyr.bands[1];
      const scaleT = (Number(p.textureScale) / 100) * ctx.scale; // Stil-px je Render-px … umgekehrt
      const [ox, oy] = ctx.origin;
      const mirror = (v: number, n: number) => {
        const m = ((v % (2 * n)) + 2 * n) % (2 * n);
        return m < n ? m : 2 * n - 1 - m;
      };
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const sx = (x + ox) / scaleT;
          const sy = (y + oy) / scaleT;
          let t = 0;
          if (b0) t += b0.d[mirror(Math.floor(sy), b0.h) * b0.w + mirror(Math.floor(sx), b0.w)] ?? 0;
          if (b1)
            t +=
              (b1.d[mirror(Math.floor(sy / 2), b1.h) * b1.w + mirror(Math.floor(sx / 2), b1.w)] ?? 0) * 0.7;
          L[y * W + x] = (L[y * W + x] ?? 0) + t * weave * 1.5;
        }
    }
    ctx.progress(0.85);

    // Helligkeit des Fotos teilweise behalten, zurück nach linear
    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const l = (L[i] ?? 0) * (1 - keepLight * 0.5) + (origL[i] ?? 0) * keepLight * 0.5;
      const [r, g, b] = linearFromOklab(Math.max(0, l), content.A.d[i] ?? 0, content.B.d[i] ?? 0);
      const a = content.alpha[i] ?? 0;
      out[i * 4] = r * a;
      out[i * 4 + 1] = g * a;
      out[i * 4 + 2] = b * a;
      out[i * 4 + 3] = a;
    }
    return out;
  },
});
