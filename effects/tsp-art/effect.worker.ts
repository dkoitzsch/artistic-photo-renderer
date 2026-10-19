// TSP-Art (Kaplan & Bosch 2005): Punkte nach Dunkelheit (Zurückweisung auf einem festen Leinwandraster, Seed), eine Tour
// durch alle Punkte (Nächster Nachbar über ein Gitter), danach 2-opt mit Nachbarlisten bis zur gewählten Durchgangszahl.
// Punkte in Leinwand-px → dieselbe Linie in Vorschau und Export; gezeichnet als geglättete Polylinie.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { measureGrid, paramColor, strokeSegment } from '../../src/effects/cpuHelpers';
import { mulberry32 } from '../../src/effects/random';

const K_NEIGHBOURS = 8;

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const sc = ctx.scale;
    const [ox, oy] = ctx.origin;
    const [cw, ch] = ctx.canvasSize;
    const n = Math.max(3, Math.round(Number(p.points)));
    const gamma = 1 + (Number(p.contrast) / 100) * 1.6;
    const ink = paramColor(p.ink, [0.08, 0.08, 0.1]);
    const paper = paramColor(p.paper, [0.97, 0.95, 0.9]);

    // 1. Dichte auf festem Raster (Leinwand), Punkte per Zurückweisung (Leinwand-px)
    const grid = measureGrid(img, ctx, 800);
    const { GW, GH, gs } = grid;
    const dens = new Float32Array(GW * GH);
    let maxD = 0;
    for (let g = 0; g < GW * GH; g++) {
      const L = grid.lab[g * 3] ?? 1;
      // Oklab-Helligkeit ≈ wahrgenommen; Dunkelheit mit Kontrastkurve
      const d = Math.pow(Math.max(0, 1 - L), gamma) * (grid.alpha[g] ?? 0) + 0.002;
      dens[g] = d;
      maxD = Math.max(maxD, d);
    }
    const rand = mulberry32(Number(p.seed) >>> 0 || 1);
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    let count = 0;
    for (let guard = 0; count < n && guard < n * 500; guard++) {
      const gx = rand() * GW;
      const gy = rand() * GH;
      if (rand() * maxD > (dens[Math.floor(gy) * GW + Math.floor(gx)] ?? 0)) continue;
      // Render-px (Leinwand) – unabhängig vom Ausschnitt
      px[count] = gx / gs;
      py[count] = gy / gs;
      count++;
    }
    ctx.progress(0.1);

    // 2. Gitter für Nachbarsuche
    const cell = Math.max(1, Math.sqrt((cw * ch) / Math.max(1, count)) * 1.5);
    const bw = Math.max(1, Math.ceil(cw / cell));
    const bh = Math.max(1, Math.ceil(ch / cell));
    const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
    const bucketOf = (i: number) =>
      Math.min(bh - 1, Math.floor((py[i] ?? 0) / cell)) * bw +
      Math.min(bw - 1, Math.floor((px[i] ?? 0) / cell));
    for (let i = 0; i < count; i++) buckets[bucketOf(i)]?.push(i);
    const d2 = (a: number, b: number) => {
      const dx = (px[a] ?? 0) - (px[b] ?? 0);
      const dy = (py[a] ?? 0) - (py[b] ?? 0);
      return dx * dx + dy * dy;
    };
    // k nächste Nachbarn je Punkt
    const neigh = new Int32Array(count * K_NEIGHBOURS).fill(-1);
    for (let i = 0; i < count; i++) {
      const bx = Math.min(bw - 1, Math.floor((px[i] ?? 0) / cell));
      const by = Math.min(bh - 1, Math.floor((py[i] ?? 0) / cell));
      const cand: { j: number; d: number }[] = [];
      for (let r = 1; cand.length < K_NEIGHBOURS + 1 && r <= Math.max(bw, bh); r++) {
        cand.length = 0;
        for (let yy = Math.max(0, by - r); yy <= Math.min(bh - 1, by + r); yy++)
          for (let xx = Math.max(0, bx - r); xx <= Math.min(bw - 1, bx + r); xx++)
            for (const j of buckets[yy * bw + xx] ?? []) if (j !== i) cand.push({ j, d: d2(i, j) });
      }
      cand.sort((a, b) => a.d - b.d);
      for (let k = 0; k < Math.min(K_NEIGHBOURS, cand.length); k++)
        neigh[i * K_NEIGHBOURS + k] = cand[k]?.j ?? -1;
    }
    ctx.progress(0.25);

    // 3. Starttour entlang einer Hilbert-Kurve über die Leinwand (keine langen Sprünge)
    const order = 1 << 12;
    const hilbert = (x: number, y: number) => {
      let d = 0;
      let xx = x;
      let yy = y;
      for (let s = order >> 1; s > 0; s >>= 1) {
        const rx = (xx & s) > 0 ? 1 : 0;
        const ry = (yy & s) > 0 ? 1 : 0;
        d += s * s * ((3 * rx) ^ ry);
        if (ry === 0) {
          if (rx === 1) {
            xx = s - 1 - xx;
            yy = s - 1 - yy;
          }
          const t = xx;
          xx = yy;
          yy = t;
        }
      }
      return d;
    };
    const side = Math.max(cw, ch);
    const keys = new Float64Array(count);
    for (let i = 0; i < count; i++)
      keys[i] = hilbert(
        Math.min(order - 1, Math.floor(((px[i] ?? 0) / side) * order)),
        Math.min(order - 1, Math.floor(((py[i] ?? 0) / side) * order)),
      );
    const tour = Int32Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => (keys[a] ?? 0) - (keys[b] ?? 0),
    );
    ctx.progress(0.35);

    // 4. 2-opt mit Nachbarlisten
    const pos = new Int32Array(count);
    for (let t = 0; t < count; t++) pos[tour[t] ?? 0] = t;
    const passes = Math.max(0, Math.round(Number(p.optimize)));
    const reverse = (i: number, j: number) => {
      // kehrt tour[i..j] um (i < j)
      while (i < j) {
        const a = tour[i] ?? 0;
        const b = tour[j] ?? 0;
        tour[i] = b;
        tour[j] = a;
        pos[b] = i;
        pos[a] = j;
        i++;
        j--;
      }
    };
    const dist = (a: number, b: number) => Math.sqrt(d2(a, b));
    for (let pass = 0; pass < passes; pass++) {
      let improved = false;
      for (let i = 0; i < count - 1; i++) {
        const a = tour[i] ?? 0;
        const b = tour[i + 1] ?? 0;
        const dab = dist(a, b);
        // Variante 1: neue Kante (a, c), c Nachbar von a, c liegt hinter b
        for (let k = 0; k < K_NEIGHBOURS; k++) {
          const c = neigh[a * K_NEIGHBOURS + k] ?? -1;
          if (c < 0) break;
          const dac = dist(a, c);
          if (dac >= dab) break;
          const j = pos[c] ?? 0;
          if (j > i + 1 && j < count - 1) {
            const d = tour[j + 1] ?? 0;
            if (dac + dist(b, d) - dab - dist(c, d) < -1e-9) {
              reverse(i + 1, j);
              improved = true;
              break;
            }
          } else if (j < i && j > 0) {
            // c liegt vor a: Kanten (e, c) mit e = Vorgänger … (c davor): (c_prev? ) → Kanten (c, cn) und (a, b)
            const cn = tour[j + 1] ?? 0;
            if (dac + dist(cn, b) - dab - dist(c, cn) < -1e-9) {
              reverse(j + 1, i);
              improved = true;
              break;
            }
          }
        }
      }
      ctx.progress(0.5 + (0.35 * (pass + 1)) / Math.max(1, passes));
      if (!improved) break;
    }

    // 5. Zeichnen (nur Segmente nahe am Ausschnitt)
    const cov = new Float32Array(W * H);
    const width = Math.max(0.2, Number(p.width) * sc);
    for (let t = 0; t < count - 1; t++) {
      const a = tour[t] ?? 0;
      const b = tour[t + 1] ?? 0;
      const x0 = (px[a] ?? 0) - ox;
      const y0 = (py[a] ?? 0) - oy;
      const x1 = (px[b] ?? 0) - ox;
      const y1 = (py[b] ?? 0) - oy;
      if (Math.max(x0, x1) < -width || Math.min(x0, x1) > W + width) continue;
      if (Math.max(y0, y1) < -width || Math.min(y0, y1) > H + width) continue;
      strokeSegment(cov, W, H, x0, y0, x1, y1, width);
    }
    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const c = cov[i] ?? 0;
      const al = img[i * 4 + 3] ?? 0;
      for (let k = 0; k < 3; k++) out[i * 4 + k] = ((paper[k] ?? 0) * (1 - c) + (ink[k] ?? 0) * c) * al;
      out[i * 4 + 3] = al;
    }
    return out;
  },
});
