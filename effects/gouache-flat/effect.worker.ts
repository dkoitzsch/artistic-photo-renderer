// Gouache (flach): SLIC-Superpixel (Achanta et al. 2012) in Oklab auf einem festen Leinwandraster, danach benachbarte
// ähnliche Flächen zusammenfassen (Union-Find nach Farbabstand). Beim Zeichnen wird die Rasterposition jedes Pixels
// mit weichem Rauschen verschoben – die Ränder werden unregelmäßig wie gemalt. Pinselstruktur und dunkle Ränder
// geben der Fläche etwas Materialität. Alles in Leinwand-Koordinaten: Vorschau = Export.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { linearFromOklab, measureGrid, valueNoise } from '../../src/effects/cpuHelpers';

const GRID_EDGE = 720;

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const seed = ctx.seed >>> 0;
    const { GW, GH, gs, lab, alpha } = measureGrid(img, ctx, GRID_EDGE);
    const N = GW * GH;
    ctx.progress(0.05);

    // 1. SLIC
    const K = Math.max(2, Math.round(Number(p.segments)));
    const S = Math.max(2, Math.sqrt(N / K));
    // Gewicht der Lage gegenüber der Farbe (SLIC: m relativ zum Farbbereich; Oklab-Helligkeit 0…1)
    const m = 0.02 + (Number(p.compact) / 100) * 0.25;
    const cx: number[] = [];
    const cy: number[] = [];
    const cl: number[] = [];
    for (let y = S / 2; y < GH; y += S)
      for (let x = S / 2; x < GW; x += S) {
        const g = Math.floor(y) * GW + Math.floor(x);
        cx.push(x);
        cy.push(y);
        cl.push(lab[g * 3] ?? 0, lab[g * 3 + 1] ?? 0, lab[g * 3 + 2] ?? 0);
      }
    let C = cx.length;
    const label = new Int32Array(N).fill(-1);
    const dist = new Float32Array(N);
    for (let it = 0; it < 6; it++) {
      dist.fill(Infinity);
      for (let k = 0; k < C; k++) {
        const kx = cx[k] ?? 0;
        const ky = cy[k] ?? 0;
        const x0 = Math.max(0, Math.floor(kx - S));
        const x1 = Math.min(GW - 1, Math.ceil(kx + S));
        const y0 = Math.max(0, Math.floor(ky - S));
        const y1 = Math.min(GH - 1, Math.ceil(ky + S));
        const L = cl[k * 3] ?? 0;
        const A = cl[k * 3 + 1] ?? 0;
        const B = cl[k * 3 + 2] ?? 0;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const g = y * GW + x;
            const dl = (lab[g * 3] ?? 0) - L;
            const da = (lab[g * 3 + 1] ?? 0) - A;
            const db = (lab[g * 3 + 2] ?? 0) - B;
            const dx = (x + 0.5 - kx) / S;
            const dy = (y + 0.5 - ky) / S;
            const d = dl * dl + da * da + db * db + m * m * (dx * dx + dy * dy) * 4;
            if (d < (dist[g] ?? Infinity)) {
              dist[g] = d;
              label[g] = k;
            }
          }
      }
      // Zentren neu
      const sum = new Float64Array(C * 6);
      for (let g = 0; g < N; g++) {
        const k = label[g] ?? -1;
        if (k < 0) continue;
        sum[k * 6] = (sum[k * 6] ?? 0) + (g % GW) + 0.5;
        sum[k * 6 + 1] = (sum[k * 6 + 1] ?? 0) + Math.floor(g / GW) + 0.5;
        sum[k * 6 + 2] = (sum[k * 6 + 2] ?? 0) + (lab[g * 3] ?? 0);
        sum[k * 6 + 3] = (sum[k * 6 + 3] ?? 0) + (lab[g * 3 + 1] ?? 0);
        sum[k * 6 + 4] = (sum[k * 6 + 4] ?? 0) + (lab[g * 3 + 2] ?? 0);
        sum[k * 6 + 5] = (sum[k * 6 + 5] ?? 0) + 1;
      }
      for (let k = 0; k < C; k++) {
        const n = sum[k * 6 + 5] ?? 0;
        if (!n) continue;
        cx[k] = (sum[k * 6] ?? 0) / n;
        cy[k] = (sum[k * 6 + 1] ?? 0) / n;
        cl[k * 3] = (sum[k * 6 + 2] ?? 0) / n;
        cl[k * 3 + 1] = (sum[k * 6 + 3] ?? 0) / n;
        cl[k * 3 + 2] = (sum[k * 6 + 4] ?? 0) / n;
      }
      ctx.progress(0.05 + 0.1 * (it + 1));
    }

    // 1b. Zusammenhang erzwingen (SLIC-Nachbearbeitung): jede zusammenhängende Fläche bekommt eine eigene Nummer;
    //     Splitter unter ¼ Superpixel übernehmen die Nummer einer schon fertigen Nachbarfläche
    {
      const comp = new Int32Array(N).fill(-1);
      const minSize = Math.max(4, Math.round((S * S) / 4));
      const queue = new Int32Array(N);
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const;
      let next = 0;
      for (let start = 0; start < N; start++) {
        if ((comp[start] ?? -1) >= 0) continue;
        const lab0 = label[start] ?? 0;
        // Nachbarfläche (bereits nummeriert) für den Fall, dass diese Fläche zu klein ist
        let adjacent = -1;
        const sx = start % GW;
        const sy = (start - sx) / GW;
        for (const [dx, dy] of dirs) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const c = comp[ny * GW + nx] ?? -1;
          if (c >= 0) adjacent = c;
        }
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        comp[start] = next;
        while (head < tail) {
          const g = queue[head++] ?? 0;
          const x = g % GW;
          const y = (g - x) / GW;
          for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
            const n = ny * GW + nx;
            if ((comp[n] ?? -1) >= 0 || (label[n] ?? 0) !== lab0) continue;
            comp[n] = next;
            queue[tail++] = n;
          }
        }
        if (tail < minSize && adjacent >= 0) for (let i = 0; i < tail; i++) comp[queue[i] ?? 0] = adjacent;
        else next++;
      }
      // neue Flächen übernehmen, Farben neu mitteln
      C = next;
      const sum = new Float64Array(C * 4);
      for (let g = 0; g < N; g++) {
        const k = comp[g] ?? 0;
        label[g] = k;
        sum[k * 4] = (sum[k * 4] ?? 0) + (lab[g * 3] ?? 0);
        sum[k * 4 + 1] = (sum[k * 4 + 1] ?? 0) + (lab[g * 3 + 1] ?? 0);
        sum[k * 4 + 2] = (sum[k * 4 + 2] ?? 0) + (lab[g * 3 + 2] ?? 0);
        sum[k * 4 + 3] = (sum[k * 4 + 3] ?? 0) + 1;
      }
      cl.length = 0;
      for (let k = 0; k < C; k++) {
        const n = sum[k * 4 + 3] || 1;
        cl.push((sum[k * 4] ?? 0) / n, (sum[k * 4 + 1] ?? 0) / n, (sum[k * 4 + 2] ?? 0) / n);
      }
    }

    // 2. Ähnliche Nachbarn zusammenfassen (Kanten nach Farbabstand sortiert, Union-Find mit Mittelwerten)
    const parent = Int32Array.from({ length: C }, (_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while ((parent[r] ?? r) !== r) r = parent[r] ?? r;
      while ((parent[i] ?? i) !== r) {
        const n = parent[i] ?? i;
        parent[i] = r;
        i = n;
      }
      return r;
    };
    const size = new Float64Array(C);
    for (let g = 0; g < N; g++) {
      const k = label[g] ?? -1;
      if (k >= 0) size[k] = (size[k] ?? 0) + 1;
    }
    const mean = Float64Array.from(cl);
    const pairs = new Set<number>();
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const a = label[y * GW + x] ?? -1;
        const r = x + 1 < GW ? (label[y * GW + x + 1] ?? -1) : -1;
        const d = y + 1 < GH ? (label[(y + 1) * GW + x] ?? -1) : -1;
        if (a >= 0 && r >= 0 && r !== a) pairs.add(Math.min(a, r) * C + Math.max(a, r));
        if (a >= 0 && d >= 0 && d !== a) pairs.add(Math.min(a, d) * C + Math.max(a, d));
      }
    const thr = (Number(p.merge) / 100) * 0.06;
    const edges = [...pairs]
      .map((e) => {
        const a = Math.floor(e / C);
        const b = e % C;
        const dl = (mean[a * 3] ?? 0) - (mean[b * 3] ?? 0);
        const da = (mean[a * 3 + 1] ?? 0) - (mean[b * 3 + 1] ?? 0);
        const db = (mean[a * 3 + 2] ?? 0) - (mean[b * 3 + 2] ?? 0);
        return { a, b, d: Math.sqrt(dl * dl + da * da + db * db) };
      })
      .sort((u, v) => u.d - v.d);
    for (const e of edges) {
      if (e.d > thr) break;
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra === rb) continue;
      // nur verschmelzen, wenn auch die aktuellen Mittel ähnlich sind (keine Ketten über Verläufe)
      const dl = (mean[ra * 3] ?? 0) - (mean[rb * 3] ?? 0);
      const da = (mean[ra * 3 + 1] ?? 0) - (mean[rb * 3 + 1] ?? 0);
      const db = (mean[ra * 3 + 2] ?? 0) - (mean[rb * 3 + 2] ?? 0);
      if (Math.sqrt(dl * dl + da * da + db * db) > thr * 1.3) continue;
      const sa = size[ra] ?? 0;
      const sb = size[rb] ?? 0;
      for (let c = 0; c < 3; c++)
        mean[ra * 3 + c] = ((mean[ra * 3 + c] ?? 0) * sa + (mean[rb * 3 + c] ?? 0) * sb) / (sa + sb || 1);
      size[ra] = sa + sb;
      parent[rb] = ra;
    }
    const region = new Int32Array(N);
    for (let g = 0; g < N; g++) region[g] = find(Math.max(0, label[g] ?? 0));
    ctx.progress(0.75);

    // 3. Farben der Flächen
    const sat = Number(p.saturation) / 100;
    const color = new Float32Array(C * 3);
    for (let k = 0; k < C; k++) {
      const r = find(k);
      const [lr, lg, lb] = linearFromOklab(
        mean[r * 3] ?? 0,
        (mean[r * 3 + 1] ?? 0) * sat,
        (mean[r * 3 + 2] ?? 0) * sat,
      );
      color[k * 3] = lr;
      color[k * 3 + 1] = lg;
      color[k * 3 + 2] = lb;
    }

    // 4. Zeichnen: Rasterposition mit Rauschen verschoben → unregelmäßige Ränder
    const out = new Float32Array(W * H * 4);
    const [ox, oy] = ctx.origin;
    const sc = ctx.scale;
    const amp = (Number(p.irregular) / 100) * S * 0.45; // in Rasterzellen
    const noiseCell = (S / gs / sc) * 0.6; // Leinwand-px
    const tex = Number(p.texture) / 100;
    const rim = Number(p.rim) / 100;
    const regionAt = (gx: number, gy: number) =>
      region[
        Math.min(GH - 1, Math.max(0, Math.floor(gy))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(gx)))
      ] ?? 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cxp = (x + ox + 0.5) / sc;
        const cyp = (y + oy + 0.5) / sc;
        const nx =
          valueNoise(cxp, cyp, noiseCell, seed, 1) -
          0.5 +
          (valueNoise(cxp, cyp, noiseCell / 3, seed, 3) - 0.5) * 0.5;
        const ny =
          valueNoise(cxp, cyp, noiseCell, seed, 2) -
          0.5 +
          (valueNoise(cxp, cyp, noiseCell / 3, seed, 4) - 0.5) * 0.5;
        const gx = (x + ox + 0.5) * gs + nx * amp * 2;
        const gy = (y + oy + 0.5) * gs + ny * amp * 2;
        const k = regionAt(gx, gy);
        let f = 1;
        if (tex > 0) {
          const t = valueNoise(cxp * 0.8, cyp * 1.5, 3 / Math.max(sc, 0.1), seed, 5);
          f *= 1 + (t - 0.5) * 0.18 * tex;
        }
        if (rim > 0) {
          // Rand: Nachbarposition gehört zu einer anderen Fläche
          const step = 1.2;
          const other =
            regionAt(gx + step, gy) !== k ||
            regionAt(gx - step, gy) !== k ||
            regionAt(gx, gy + step) !== k ||
            regionAt(gx, gy - step) !== k;
          if (other) f *= 1 - 0.22 * rim;
        }
        const a =
          alpha[
            Math.min(GH - 1, Math.floor((y + oy + 0.5) * gs)) * GW +
              Math.min(GW - 1, Math.floor((x + ox + 0.5) * gs))
          ] ?? 1;
        const i = (y * W + x) * 4;
        const srcA = img[i + 3] ?? 0;
        const aa = srcA > 0 ? srcA : a;
        out[i] = (color[k * 3] ?? 0) * f * aa;
        out[i + 1] = (color[k * 3 + 1] ?? 0) * f * aa;
        out[i + 2] = (color[k * 3 + 2] ?? 0) * f * aa;
        out[i + 3] = aa;
      }
      if ((y & 63) === 0) ctx.progress(0.75 + (0.25 * y) / H);
    }
    return out;
  },
});
