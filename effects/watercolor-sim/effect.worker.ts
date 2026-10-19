// Aquarell (Simulation, vereinfacht nach Curtis et al. 1997):
//  1. Bild auf einem festen Raster über der Leinwand messen (Oklab), in Lasuren zerlegen (k-Means, hell → dunkel).
//  2. Je Lasur ein Pigmentrezept (Pigment-Engine, mit Weiß gesucht; Weiß = Wasser, also dünnere Schicht) und K/S der
//     Mischung; die Schichtdicke wird so bestimmt, dass die Lasur über dem Papier ihren Zielton trifft.
//  3. Nasse Fläche: Maske der Lasur, je nach Wassermenge erweitert und mit unregelmäßigem Rand; Pigment verläuft darin
//     (Nass in Nass), wandert in Trocknungsschritten zum Rand (Randverdunkelung); Blüten als Ringe aus Rauschen.
//  4. Schichten nach Kubelka-Munk (31 Stützstellen) über dem Papier; Ergebnis hochskaliert, Papierstruktur und
//     Granulation in voller Auflösung. Alles in Leinwand-Koordinaten: Vorschau und Export gleich.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { linearFromOklab, measureGrid, valueNoise } from '../../src/effects/cpuHelpers';
import { mulberry32 } from '../../src/effects/random';
import { findMix, layerReflectance, mixConstants, mixGranulation } from '../../src/pigments/engine';
import { BANDS, deltaE2000, encodeSrgb, spectrumToLinear, srgbToLab } from '../../src/pigments/spectral';

const SETS: Record<string, string[]> = {
  standard: [
    'ultramarine',
    'phthalo-blue',
    'cadmium-yellow-light',
    'yellow-ochre',
    'burnt-sienna',
    'cadmium-red-light',
    'alizarin-permanent',
    'phthalo-green',
  ],
  earth: ['yellow-ochre', 'raw-sienna', 'burnt-sienna', 'burnt-umber', 'ultramarine', 'payne-grey'],
  granulating: [
    'ultramarine',
    'cerulean',
    'cobalt-blue',
    'raw-sienna',
    'burnt-sienna',
    'viridian',
    'raw-umber',
  ],
};

/** Papierreflexion (leicht warmes Weiß) */
const PAPER = 0.9;

/** Kastenunschärfe (drei Durchgänge) eines Rasters */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const rad = Math.max(0, Math.round(r));
  if (rad < 1) return src.slice();
  const a = src.slice();
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) s += a[y * w + Math.min(w - 1, Math.max(0, i))] ?? 0;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s / (2 * rad + 1);
        s += (a[y * w + Math.min(w - 1, x + rad + 1)] ?? 0) - (a[y * w + Math.max(0, x - rad)] ?? 0);
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) s += b[Math.min(h - 1, Math.max(0, i)) * w + x] ?? 0;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * rad + 1);
        s += (b[Math.min(h - 1, y + rad + 1) * w + x] ?? 0) - (b[Math.max(0, y - rad) * w + x] ?? 0);
      }
    }
  }
  return a;
}

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const seed = ctx.seed >>> 0;
    const sc = ctx.scale;
    const [ox, oy] = ctx.origin;
    const grid = measureGrid(img, ctx, Number(p.gridSize) || 640);
    const { GW, GH, gs, lab } = grid;
    const N = GW * GH;
    ctx.progress(0.05);

    // 1. Lasuren: k-Means in Oklab (Seed), sortiert hell → dunkel
    const K = Math.max(2, Math.min(12, Math.round(Number(p.washes))));
    const rand = mulberry32(seed || 1);
    const centers: number[][] = [];
    for (let k = 0; k < K; k++) {
      const g = Math.floor(rand() * N);
      centers.push([lab[g * 3] ?? 0.5, lab[g * 3 + 1] ?? 0, lab[g * 3 + 2] ?? 0]);
    }
    const assign = new Int32Array(N);
    for (let it = 0; it < 12; it++) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (let g = 0; g < N; g++) {
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < K; k++) {
          const c = centers[k] ?? [0, 0, 0];
          const d =
            ((lab[g * 3] ?? 0) - (c[0] ?? 0)) ** 2 +
            ((lab[g * 3 + 1] ?? 0) - (c[1] ?? 0)) ** 2 +
            ((lab[g * 3 + 2] ?? 0) - (c[2] ?? 0)) ** 2;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        assign[g] = best;
        const s = sums[best];
        if (!s) continue;
        s[0] = (s[0] ?? 0) + (lab[g * 3] ?? 0);
        s[1] = (s[1] ?? 0) + (lab[g * 3 + 1] ?? 0);
        s[2] = (s[2] ?? 0) + (lab[g * 3 + 2] ?? 0);
        s[3] = (s[3] ?? 0) + 1;
      }
      sums.forEach((s, k) => {
        if (!s[3]) return;
        centers[k] = [(s[0] ?? 0) / s[3], (s[1] ?? 0) / s[3], (s[2] ?? 0) / s[3]];
      });
    }
    const order = centers.map((c, k) => ({ k, L: c[0] ?? 0 })).sort((a, b) => b.L - a.L);
    ctx.progress(0.15);

    // 2. Rezepte und Schichtdicke je Lasur
    const set = SETS[String(p.pigments)] ?? SETS.standard ?? [];
    const washes = order.map(({ k }) => {
      const c = centers[k] ?? [0.8, 0, 0];
      const lin = linearFromOklab(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
      // Aquarell lebt vom Papierweiß: Zieltöne leicht aufgehellt (dunkelste Stellen werden nicht schwarz)
      const target = lin.map((v) => Math.min(1, Math.max(0, encodeSrgb(v) * 0.82 + 0.16))) as [
        number,
        number,
        number,
      ];
      const recipe = findMix(target, [...set, 'titanium-white'], 3);
      const parts = recipe.parts
        .filter((x) => x.id !== 'titanium-white')
        .map((x) => ({ id: x.id, parts: x.fraction }));
      const use = parts.length ? parts : [{ id: set[0] ?? 'ultramarine', parts: 1 }];
      const { K: KK, S: SS } = mixConstants(use);
      const tLab = srgbToLab(target);
      // Dicke so, dass eine Schicht über dem Papier den Zielton trifft (logarithmische Suche)
      const colorAt = (x: number) => {
        const r = new Float64Array(BANDS);
        for (let i = 0; i < BANDS; i++) r[i] = layerReflectance(KK[i] ?? 0, SS[i] ?? 1, x, PAPER);
        return spectrumToLinear(r).map((v) => Math.min(1, Math.max(0, encodeSrgb(v))));
      };
      let bestX = 0.1;
      let bestD = Infinity;
      for (let e = -4; e <= 2.5; e += 0.25) {
        const x = Math.exp(e);
        const d = deltaE2000(srgbToLab(colorAt(x)), tLab);
        if (d < bestD) {
          bestD = d;
          bestX = x;
        }
      }
      return { k, K: KK, S: SS, x: bestX, gran: mixGranulation(use) };
    });
    ctx.progress(0.3);

    // 3. Anteile je Lasur: Masken mit Verlauf (Wassermenge), unregelmäßigem Rand, Randverdunkelung und Blüten.
    //    Die Anteile summieren sich je Zelle zu 1 – Verlaufen mischt Lasuren, statt sie dunkel zu stapeln.
    const water = Number(p.water) / 100;
    const edgeDark = Number(p.edges) / 100;
    const backruns = Number(p.backruns) / 100;
    const drying = Math.max(1, Math.round(Number(p.drying)));
    const cellPx = 1 / gs / sc; // Leinwand-px je Zelle
    const bleed = 0.6 + water * 3.5;
    const soft: Float32Array[] = washes.map((wash, idx) => {
      const m = new Float32Array(N);
      for (let g = 0; g < N; g++) m[g] = assign[g] === wash.k ? 1 : 0;
      const sm = blur(m, GW, GH, bleed);
      // unregelmäßiger Rand: feines Rauschen auf die Schwelle
      for (let g = 0; g < N; g++) {
        const x = ((g % GW) + 0.5) * cellPx;
        const y = (Math.floor(g / GW) + 0.5) * cellPx;
        const n = valueNoise(x, y, 10 * cellPx, seed, 20 + idx) - 0.5;
        const v = (sm[g] ?? 0) + n * 0.25 * (0.4 + water);
        sm[g] = Math.min(1, Math.max(0, (v - 0.12) / 0.6));
      }
      return sm;
    });
    const thick: Float32Array[] = soft.map(() => new Float32Array(N));
    const granMap = new Float32Array(N);
    const coverSum = new Float32Array(N);
    for (let g = 0; g < N; g++) {
      let sum = 0;
      for (const sm of soft) sum += sm[g] ?? 0;
      // Lücken zwischen Lasuren größtenteils schließen (schmale Papierstreifen bleiben)
      const k = sum > 1e-6 ? 1 / Math.max(0.8, sum) : 0;
      soft.forEach((sm, i) => {
        const t = thick[i];
        sm[g] = (sm[g] ?? 0) * k;
        if (t) t[g] = sm[g] ?? 0;
      });
    }
    washes.forEach((wash, idx) => {
      const t = thick[idx];
      if (!t) return;
      // Trocknen: Pigment sammelt sich am inneren Rand der eigenen Fläche (je Schritt etwas breiter, nicht kumulativ)
      const base = t.slice();
      const rimSum = new Float32Array(N);
      for (let s = 0; s < drying; s++) {
        const inner = blur(base, GW, GH, 1.5 + s * 1.2);
        for (let g = 0; g < N; g++)
          rimSum[g] = (rimSum[g] ?? 0) + Math.max(0, (base[g] ?? 0) - (inner[g] ?? 0)) / drying;
      }
      for (let g = 0; g < N; g++) {
        const v = base[g] ?? 0;
        if (v < 0.02) continue;
        t[g] = v * Math.min(1.8, 1 + edgeDark * (rimSum[g] ?? 0) * 3);
      }
      // Blüten: helle Innenfläche mit dunklem Ring, wo Rauschen eine Schwelle kreuzt
      if (backruns > 0)
        for (let g = 0; g < N; g++) {
          const v = t[g] ?? 0;
          if (v < 0.3) continue;
          const x = ((g % GW) + 0.5) * cellPx;
          const y = (Math.floor(g / GW) + 0.5) * cellPx;
          const n = valueNoise(x, y, 26 * cellPx, seed, 40 + idx);
          const ring = Math.exp(-(((n - 0.64) / 0.02) ** 2));
          t[g] = v * (1 + backruns * (ring * 0.8 - (n > 0.64 ? 0.35 : 0)));
        }
      for (let g = 0; g < N; g++) {
        const v = t[g] ?? 0;
        granMap[g] = (granMap[g] ?? 0) + v * wash.gran;
        coverSum[g] = (coverSum[g] ?? 0) + v;
      }
      ctx.progress(0.3 + (0.4 * (idx + 1)) / washes.length);
    });

    // 4. Je Zelle: jede Lasur als Schicht über dem Papier (31 Stützstellen), Dicke = Kalibrierung × Pigmentmenge
    //    (Randverdunkelung, Blüten); die Lasuren einer Zelle mischen sich nach ihrem Anteil, der Rest bleibt Papier.
    const rgb = new Float32Array(N * 3);
    const r = new Float64Array(BANDS);
    const one = new Float64Array(BANDS);
    for (let g = 0; g < N; g++) {
      r.fill(0);
      let shareSum = 0;
      washes.forEach((wash, i) => {
        const base = soft[i]?.[g] ?? 0;
        const t = thick[i]?.[g] ?? 0;
        if (base < 0.01) return;
        const share = base;
        // Dicke relativ zum Anteil: 1 = Zielton, > 1 am Rand und in Blüten-Ringen
        const rel = Math.min(1.8, t / Math.max(1e-3, base));
        const x = wash.x * rel;
        for (let b = 0; b < BANDS; b++) one[b] = layerReflectance(wash.K[b] ?? 0, wash.S[b] ?? 1, x, PAPER);
        for (let b = 0; b < BANDS; b++) r[b] = (r[b] ?? 0) + (one[b] ?? 0) * share;
        shareSum += share;
      });
      for (let b = 0; b < BANDS; b++) r[b] = (r[b] ?? 0) + PAPER * Math.max(0, 1 - shareSum);
      const [lr, lg, lb] = spectrumToLinear(r);
      rgb[g * 3] = lr;
      rgb[g * 3 + 1] = lg;
      rgb[g * 3 + 2] = lb;
      const c = coverSum[g] ?? 0;
      granMap[g] = c > 0 ? (granMap[g] ?? 0) / c : 0;
    }
    ctx.progress(0.85);

    // 5. Hochskalieren, Papierstruktur und Granulation in voller Auflösung
    const paperKind = String(p.paper);
    const paperCell = paperKind === 'hot' ? 1.5 : paperKind === 'rough' ? 5 : 3;
    const paperAmp = paperKind === 'hot' ? 0.015 : paperKind === 'rough' ? 0.06 : 0.035;
    const granAmt = Number(p.granulation) / 100;
    const detail = Number(p.detail) / 100;
    const out = new Float32Array(W * H * 4);
    const at = (arr: Float32Array, gx: number, gy: number, ch: number, stride: number) => {
      const x = Math.min(GW - 1.001, Math.max(0, gx));
      const y = Math.min(GH - 1.001, Math.max(0, gy));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = x - x0;
      const ty = y - y0;
      const i = y0 * GW + x0;
      const v = (k: number) => arr[(i + k) * stride + ch] ?? 0;
      return (v(0) * (1 - tx) + v(1) * tx) * (1 - ty) + (v(GW) * (1 - tx) + v(GW + 1) * tx) * ty;
    };
    for (let y = 0; y < H; y++) {
      const gy = (y + oy + 0.5) * gs - 0.5;
      for (let x = 0; x < W; x++) {
        const gx = (x + ox + 0.5) * gs - 0.5;
        const cx = (x + ox + 0.5) / sc;
        const cy = (y + oy + 0.5) / sc;
        const paperN = valueNoise(cx, cy, paperCell, seed, 1) - 0.5;
        const gran = at(granMap, gx, gy, 0, 1);
        const cover = Math.min(1, at(coverSum, gx, gy, 0, 1));
        // Granulation: Pigment sammelt sich in den Tälern des Papiers
        let f = 1 + paperN * paperAmp * 2 - Math.max(0, -paperN) * granAmt * gran * Math.min(1, cover) * 0.5;
        const i = (y * W + x) * 4;
        const a = img[i + 3] ?? 0;
        // Details: feine dunkle Striche aus dem Original (trocken aufgetragen), nur abdunkelnd
        if (detail > 0) {
          const lumHere =
            ((img[i] ?? 0) * 0.2126 + (img[i + 1] ?? 0) * 0.7152 + (img[i + 2] ?? 0) * 0.0722) / (a || 1);
          const lumGrid = at(rgb, gx, gy, 1, 3);
          const ratio = Math.min(1, (lumHere + 0.02) / (lumGrid + 0.02));
          f *= 1 - detail * (1 - ratio) * 0.8;
        }
        out[i] = Math.max(0, at(rgb, gx, gy, 0, 3) * f) * a;
        out[i + 1] = Math.max(0, at(rgb, gx, gy, 1, 3) * f) * a;
        out[i + 2] = Math.max(0, at(rgb, gx, gy, 2, 3) * f) * a;
        out[i + 3] = a;
      }
      if ((y & 127) === 0) ctx.progress(0.85 + (0.15 * y) / H);
    }
    return out;
  },
});
