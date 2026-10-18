// Stippling nach Secord (2002): Punkte nach der Dunkelheit verteilen und per gewichteter Lloyd-Relaxation (Schwerpunkte
// der Voronoi-Zellen, gewichtet mit der Dichte) gleichmäßig machen. Die Dichte wird auf einem festen Raster über der
// Leinwand gemessen (unabhängig von der Render-Auflösung) – Vorschau und Export ergeben dieselben Punkte.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { mulberry32 } from '../../src/effects/random';

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((Math.max(0, c) + 0.055) / 1.055) ** 2.4);

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const n = Math.max(1, Math.round(Number(p.dots)));
    const iterations = Math.max(0, Math.round(Number(p.iterations)));
    const gamma = 1 + (Number(p.contrast) / 100) * 1.6;
    const [cw, ch] = ctx.canvasSize;
    const [ox, oy] = ctx.origin;

    // 1. Dichte auf festem Raster (lange Kante abhängig von der Punktzahl): fein genug, dass auch in dunklen Bereichen
    //    viele Rasterzellen auf einen Punkt kommen – sonst rasten die Schwerpunkte am Raster ein
    const edge = Math.min(1600, Math.max(512, Math.round(Math.sqrt(n) * 16)));
    const gs = edge / Math.max(cw, ch); // Rasterzellen je Render-px der Leinwand
    const GW = Math.max(1, Math.round(cw * gs));
    const GH = Math.max(1, Math.round(ch * gs));
    const sum = new Float64Array(GW * GH);
    const cnt = new Float64Array(GW * GH);
    for (let y = 0; y < H; y++) {
      const gy = Math.min(GH - 1, Math.floor((y + oy + 0.5) * gs));
      for (let x = 0; x < W; x++) {
        const gx = Math.min(GW - 1, Math.floor((x + ox + 0.5) * gs));
        const i = (y * W + x) * 4;
        const a = img[i + 3] ?? 0;
        let dark = 0;
        if (a > 0) {
          const l = ((img[i] ?? 0) * 0.2126 + (img[i + 1] ?? 0) * 0.7152 + (img[i + 2] ?? 0) * 0.0722) / a;
          dark = (1 - enc(Math.min(1, Math.max(0, l)))) * a;
        }
        sum[gy * GW + gx] = (sum[gy * GW + gx] ?? 0) + dark;
        cnt[gy * GW + gx] = (cnt[gy * GW + gx] ?? 0) + 1;
      }
    }
    const dens = new Float32Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) {
      const d = (cnt[i] ?? 0) > 0 ? (sum[i] ?? 0) / (cnt[i] ?? 1) : 0;
      dens[i] = 0.002 + Math.pow(d, gamma);
    }
    ctx.progress(0.05);

    // 2. Startpunkte: Zurückweisungsverfahren nach Dichte (Seed)
    const rand = mulberry32(Number(p.seed) >>> 0);
    let maxD = 0;
    for (const d of dens) maxD = Math.max(maxD, d);
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let k = 0, guard = 0; k < n && guard < n * 400; guard++) {
      const x = rand() * GW;
      const y = rand() * GH;
      if (rand() * maxD <= (dens[Math.floor(y) * GW + Math.floor(x)] ?? 0)) {
        px[k] = x;
        py[k] = y;
        k++;
      }
    }

    // 3. Gewichtete Lloyd-Relaxation mit Eimer-Raster zur Suche des nächsten Punkts
    const bucket = Math.max(1, Math.sqrt((GW * GH) / n) * 1.4);
    const BW = Math.ceil(GW / bucket);
    const BH = Math.ceil(GH / bucket);
    const cx = new Float64Array(n);
    const cy = new Float64Array(n);
    const cm = new Float64Array(n);
    // Fläche je Punkt (Rasterzellen) aus der letzten Zuordnung – begrenzt die Punktgröße auf den örtlichen Abstand
    const area = new Float64Array(n);
    const passes = Math.max(1, iterations);
    for (let it = 0; it < passes; it++) {
      const start = new Int32Array(BW * BH + 1);
      const cell = new Int32Array(n);
      for (let k = 0; k < n; k++) {
        const b =
          Math.min(BH - 1, Math.floor((py[k] ?? 0) / bucket)) * BW +
          Math.min(BW - 1, Math.floor((px[k] ?? 0) / bucket));
        cell[k] = b;
        start[b + 1] = (start[b + 1] ?? 0) + 1;
      }
      for (let b = 0; b < BW * BH; b++) start[b + 1] = (start[b + 1] ?? 0) + (start[b] ?? 0);
      const fill = start.slice(0, BW * BH);
      const items = new Int32Array(n);
      for (let k = 0; k < n; k++) {
        const b = cell[k] ?? 0;
        items[fill[b] ?? 0] = k;
        fill[b] = (fill[b] ?? 0) + 1;
      }
      cx.fill(0);
      cy.fill(0);
      cm.fill(0);
      area.fill(0);
      for (let y = 0; y < GH; y++) {
        const by = Math.min(BH - 1, Math.floor((y + 0.5) / bucket));
        for (let x = 0; x < GW; x++) {
          const bx = Math.min(BW - 1, Math.floor((x + 0.5) / bucket));
          let best = -1;
          let bd = Infinity;
          for (let r = 1; r <= 4; r++) {
            for (let yy = Math.max(0, by - r); yy <= Math.min(BH - 1, by + r); yy++)
              for (let xx = Math.max(0, bx - r); xx <= Math.min(BW - 1, bx + r); xx++) {
                const b = yy * BW + xx;
                for (let j = start[b] ?? 0; j < (start[b + 1] ?? 0); j++) {
                  const k = items[j] ?? 0;
                  const dx = (px[k] ?? 0) - x - 0.5;
                  const dy = (py[k] ?? 0) - y - 0.5;
                  const d = dx * dx + dy * dy;
                  if (d < bd) {
                    bd = d;
                    best = k;
                  }
                }
              }
            // genug gesucht, wenn der nächste Punkt näher liegt als der Rand des Suchbereichs
            if (best >= 0 && bd <= (r * bucket) ** 2) break;
          }
          const i = y * GW + x;
          if (best < 0) continue;
          area[best] = (area[best] ?? 0) + 1;
          const w = dens[i] ?? 0;
          cx[best] = (cx[best] ?? 0) + w * (x + 0.5);
          cy[best] = (cy[best] ?? 0) + w * (y + 0.5);
          cm[best] = (cm[best] ?? 0) + w;
        }
      }
      for (let k = 0; k < n && it < iterations; k++) {
        const m = cm[k] ?? 0;
        if (m > 0) {
          px[k] = (cx[k] ?? 0) / m;
          py[k] = (cy[k] ?? 0) / m;
        }
      }
      ctx.progress(0.05 + (0.8 * (it + 1)) / Math.max(1, iterations));
    }

    // 4. Punkte zeichnen: Größe nach der Dunkelheit am Punkt, Kantenglättung über die Pixelabdeckung
    const cov = new Float32Array(W * H);
    const minS = Number(p.minSize) * ctx.scale;
    const maxS = Number(p.maxSize) * ctx.scale;
    for (let k = 0; k < n; k++) {
      const gx = px[k] ?? 0;
      const gy = py[k] ?? 0;
      const d = dens[Math.min(GH - 1, Math.floor(gy)) * GW + Math.min(GW - 1, Math.floor(gx))] ?? 0;
      const t = Math.min(1, Math.max(0, (d - 0.002) ** (1 / gamma)));
      // örtlicher Abstand ≈ Wurzel der Zellfläche (in Render-px); Punkte bleiben getrennt
      const spacing = Math.sqrt(Math.max(1, area[k] ?? 1)) / gs;
      const r = Math.max(0.35, Math.min((minS + (maxS - minS) * t) / 2, 0.42 * spacing));
      const x0 = gx / gs - ox;
      const y0 = gy / gs - oy;
      for (let y = Math.max(0, Math.floor(y0 - r - 1)); y <= Math.min(H - 1, Math.ceil(y0 + r + 1)); y++)
        for (let x = Math.max(0, Math.floor(x0 - r - 1)); x <= Math.min(W - 1, Math.ceil(x0 + r + 1)); x++) {
          const dist = Math.hypot(x + 0.5 - x0, y + 0.5 - y0);
          const c = Math.min(1, Math.max(0, r + 0.5 - dist));
          if (c > (cov[y * W + x] ?? 0)) cov[y * W + x] = c;
        }
    }
    ctx.progress(0.95);

    const ink = (p.ink as number[]).map(dec);
    const paper = (p.paper as number[]).map(dec);
    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const c = cov[i] ?? 0;
      const a = img[i * 4 + 3] ?? 0;
      for (let k = 0; k < 3; k++)
        out[i * 4 + k] = ((paper[k] ?? 1) + ((ink[k] ?? 0) - (paper[k] ?? 1)) * c) * a;
      out[i * 4 + 3] = a;
    }
    return out;
  },
});
