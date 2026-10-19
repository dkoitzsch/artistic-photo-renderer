// Kreuzstich: Leinwand in Stichzellen (ortsfest, Zellgröße in Leinwand-px), Zellfarbe = Mittel des Bildes, Garnfarben per
// k-Means in Oklab (Seed). Jede Zelle bekommt zwei gekreuzte Garnstiche (Oberstich „/“ über Unterstich „\“) mit runder
// Fadenschattierung, Drall und Glanz; dazwischen Aida-Stoff mit Webstruktur und Löchern an den Zellecken.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { linearFromOklab, oklabFromLinear, paramColor } from '../../src/effects/cpuHelpers';
import { mulberry32, randCell } from '../../src/effects/random';

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const seed = ctx.seed >>> 0;
    const sc = ctx.scale;
    const [ox, oy] = ctx.origin;
    const cell = Math.max(1, Number(p.stitch) * sc); // Render-px
    const k = Math.max(2, Math.min(32, Math.round(Number(p.colors))));
    const fabric = paramColor(p.fabric, [0.93, 0.9, 0.82]);
    const skip = Number(p.skipLight) / 100;
    const thread = Number(p.thread) / 100;
    const sheen = Number(p.sheen) / 100;
    const irregular = Number(p.irregular) / 100;

    // 1. Zellmittel (Zellen an der Leinwand ausgerichtet)
    const c0 = Math.floor(ox / cell);
    const r0 = Math.floor(oy / cell);
    const CW = Math.floor((ox + W) / cell) - c0 + 1;
    const CH = Math.floor((oy + H) / cell) - r0 + 1;
    const acc = new Float64Array(CW * CH * 5);
    for (let y = 0; y < H; y++) {
      const cy = Math.floor((y + oy) / cell) - r0;
      for (let x = 0; x < W; x++) {
        const cx = Math.floor((x + ox) / cell) - c0;
        const i = (y * W + x) * 4;
        const c = (cy * CW + cx) * 5;
        acc[c] = (acc[c] ?? 0) + (img[i] ?? 0);
        acc[c + 1] = (acc[c + 1] ?? 0) + (img[i + 1] ?? 0);
        acc[c + 2] = (acc[c + 2] ?? 0) + (img[i + 2] ?? 0);
        acc[c + 3] = (acc[c + 3] ?? 0) + (img[i + 3] ?? 0);
        acc[c + 4] = (acc[c + 4] ?? 0) + 1;
      }
    }
    const n = CW * CH;
    const lab = new Float32Array(n * 3);
    const cover = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const cnt = acc[c * 5 + 4] || 1;
      const a = (acc[c * 5 + 3] ?? 0) / cnt;
      cover[c] = a;
      const d = (acc[c * 5 + 3] ?? 0) || 1;
      const l = oklabFromLinear((acc[c * 5] ?? 0) / d, (acc[c * 5 + 1] ?? 0) / d, (acc[c * 5 + 2] ?? 0) / d);
      lab[c * 3] = l[0];
      lab[c * 3 + 1] = l[1];
      lab[c * 3 + 2] = l[2];
    }
    ctx.progress(0.2);

    // 2. Garnfarben: k-Means in Oklab (k-means++-Start mit Seed)
    const rand = mulberry32(seed || 1);
    const centers = new Float32Array(k * 3);
    const pick = (c: number, j: number) => {
      centers[j * 3] = lab[c * 3] ?? 0;
      centers[j * 3 + 1] = lab[c * 3 + 1] ?? 0;
      centers[j * 3 + 2] = lab[c * 3 + 2] ?? 0;
    };
    pick(Math.floor(rand() * n), 0);
    const dmin = new Float32Array(n).fill(Infinity);
    const dist2 = (c: number, j: number) => {
      const a = (lab[c * 3] ?? 0) - (centers[j * 3] ?? 0);
      const b = (lab[c * 3 + 1] ?? 0) - (centers[j * 3 + 1] ?? 0);
      const e = (lab[c * 3 + 2] ?? 0) - (centers[j * 3 + 2] ?? 0);
      return a * a + b * b + e * e;
    };
    for (let j = 1; j < k; j++) {
      let total = 0;
      for (let c = 0; c < n; c++) {
        dmin[c] = Math.min(dmin[c] ?? Infinity, dist2(c, j - 1));
        total += dmin[c] ?? 0;
      }
      let r = rand() * total;
      let chosen = n - 1;
      for (let c = 0; c < n; c++) {
        r -= dmin[c] ?? 0;
        if (r <= 0) {
          chosen = c;
          break;
        }
      }
      pick(chosen, j);
    }
    const assign = new Int32Array(n);
    for (let it = 0; it < 10; it++) {
      const sum = new Float64Array(k * 4);
      for (let c = 0; c < n; c++) {
        let best = 0;
        let bd = Infinity;
        for (let j = 0; j < k; j++) {
          const d = dist2(c, j);
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
        assign[c] = best;
        sum[best * 4] = (sum[best * 4] ?? 0) + (lab[c * 3] ?? 0);
        sum[best * 4 + 1] = (sum[best * 4 + 1] ?? 0) + (lab[c * 3 + 1] ?? 0);
        sum[best * 4 + 2] = (sum[best * 4 + 2] ?? 0) + (lab[c * 3 + 2] ?? 0);
        sum[best * 4 + 3] = (sum[best * 4 + 3] ?? 0) + 1;
      }
      for (let j = 0; j < k; j++) {
        const m = sum[j * 4 + 3] ?? 0;
        if (!m) continue;
        centers[j * 3] = (sum[j * 4] ?? 0) / m;
        centers[j * 3 + 1] = (sum[j * 4 + 1] ?? 0) / m;
        centers[j * 3 + 2] = (sum[j * 4 + 2] ?? 0) / m;
      }
    }
    const yarn = new Float32Array(k * 3);
    for (let j = 0; j < k; j++) {
      const [r, g, b] = linearFromOklab(
        centers[j * 3] ?? 0,
        centers[j * 3 + 1] ?? 0,
        centers[j * 3 + 2] ?? 0,
      );
      yarn[j * 3] = r;
      yarn[j * 3 + 1] = g;
      yarn[j * 3 + 2] = b;
    }
    ctx.progress(0.45);

    // 3. Zeichnen
    const out = new Float32Array(W * H * 4);
    const half = thread * 0.36; // halbe Fadenbreite (Anteil der Zelle, quer zur Diagonale)
    const skipL = 1 - skip * 0.35; // Oklab-Helligkeit, ab der Zellen frei bleiben
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const gx = (x + ox + 0.5) / cell;
        const gy = (y + oy + 0.5) / cell;
        const ci = Math.floor(gx);
        const cj = Math.floor(gy);
        const u = gx - ci;
        const v = gy - cj;
        const c = (cj - r0) * CW + (ci - c0);
        const i = (y * W + x) * 4;
        const a = img[i + 3] ?? 0;
        // Stoff: Webstruktur (Kreuzgewebe) und Löcher an den Zellecken
        const weave = 0.94 + 0.06 * Math.cos(u * Math.PI * 6) * Math.cos(v * Math.PI * 6);
        const hole = Math.min(1, Math.hypot(Math.min(u, 1 - u), Math.min(v, 1 - v)) / 0.12);
        let r = fabric[0] * weave * (0.55 + 0.45 * hole);
        let g = fabric[1] * weave * (0.55 + 0.45 * hole);
        let b = fabric[2] * weave * (0.55 + 0.45 * hole);
        const stitched = (cover[c] ?? 0) > 0.5 && (lab[c * 3] ?? 1) < skipL;
        if (stitched) {
          const j = assign[c] ?? 0;
          // leichte Unregelmäßigkeit je Stich (Ortszufall der Zelle)
          const jx = (randCell(ci, cj, seed, 1) - 0.5) * irregular * 0.12;
          const jy = (randCell(ci, cj, seed, 2) - 0.5) * irregular * 0.12;
          const uu = u - 0.5 + jx;
          const vv = v - 0.5 + jy;
          // Abstand zu den Diagonalen (in Zellbreiten)
          const dTop = Math.abs(uu + vv) / Math.SQRT2; // „/“ (oben)
          const dBot = Math.abs(uu - vv) / Math.SQRT2; // „\“ (unten)
          const inside = Math.max(Math.abs(uu), Math.abs(vv)) < 0.47;
          let t = -1;
          let along = 0;
          let under = 1;
          if (inside && dTop < half) {
            t = dTop / half;
            along = (uu - vv) / Math.SQRT2;
          } else if (inside && dBot < half) {
            // Unterstich: etwas dunkler, an der Kreuzung vom Oberstich verdeckt
            t = dBot / half;
            along = (uu + vv) / Math.SQRT2;
            under = 0.88;
          }
          if (t >= 0) {
            // runder Faden: zur Mitte heller, Drall als schräge Streifen, Glanzlicht
            const round = 1 - 0.45 * t * t;
            const twist = 0.88 + 0.12 * Math.cos((along * 7 + t * 2) * Math.PI);
            const spec = sheen * 0.25 * Math.max(0, 1 - t * 2.2);
            const f = round * twist;
            r = (yarn[j * 3] ?? 0) * f * under + spec;
            g = (yarn[j * 3 + 1] ?? 0) * f * under + spec;
            b = (yarn[j * 3 + 2] ?? 0) * f * under + spec;
          } else if (inside && Math.min(dTop, dBot) < half * 1.35) {
            // Schatten des Fadens auf dem Stoff
            r *= 0.8;
            g *= 0.8;
            b *= 0.8;
          }
        }
        out[i] = r * a;
        out[i + 1] = g * a;
        out[i + 2] = b * a;
        out[i + 3] = a;
      }
      if ((y & 63) === 0) ctx.progress(0.45 + (0.55 * y) / H);
    }
    return out;
  },
});
