// Pinselstriche (Hertzmann 1998): erzeugt die Striche (strokes.ts) und malt sie auf den Malgrund – runde Enden,
// Deckkraft, Borstenstruktur (ortsfestes Rauschen quer zum Strich). Ausgabe RGBA linear vormultipliziert.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { paramColor, valueNoise } from '../../src/effects/cpuHelpers';
import { generateStrokes, type Stroke } from './strokes';

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const ground = paramColor(p.ground, [0.86, 0.8, 0.7]);
    const canvas = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      canvas[i * 3] = ground[0];
      canvas[i * 3 + 1] = ground[1];
      canvas[i * 3 + 2] = ground[2];
    }
    const opacity = Number(p.opacity) / 100;
    const bristles = Number(p.bristles) / 100;
    const sc = ctx.scale;
    const [ox, oy] = ctx.origin;
    const seed = ctx.seed >>> 0;
    // Deckung des aktuellen Strichs (Maximum über alle Segmente, damit Überlappungen nicht doppelt decken)
    const cov = new Float32Array(W * H);
    const touched: number[] = [];

    const paint = (s: Stroke) => {
      const r = s.width / 2;
      const pts = s.points;
      touched.length = 0;
      const seg = (x0: number, y0: number, x1: number, y1: number) => {
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
            const d = Math.hypot(px - t * dx, py - t * dy);
            const v = Math.max(0, Math.min(1, r + 0.5 - d));
            if (v <= 0) continue;
            const i = y * W + x;
            if ((cov[i] ?? 0) === 0) touched.push(i);
            if (v > (cov[i] ?? 0)) cov[i] = v;
          }
      };
      if (pts.length <= 2) seg(pts[0] ?? 0, pts[1] ?? 0, pts[0] ?? 0, pts[1] ?? 0);
      for (let k = 2; k < pts.length; k += 2)
        seg(pts[k - 2] ?? 0, pts[k - 1] ?? 0, pts[k] ?? 0, pts[k + 1] ?? 0);
      for (const i of touched) {
        let a = (cov[i] ?? 0) * opacity;
        if (bristles > 0) {
          // feine Streifen: ortsfestes Rauschen, gestreckt (Borsten), in Leinwand-px
          const x = ((i % W) + ox) / sc;
          const y = (Math.floor(i / W) + oy) / sc;
          const nz = valueNoise(x, y, Math.max(1, s.width / sc / 6), seed, s.order % 7);
          a *= 1 - bristles * 0.55 * nz;
        }
        canvas[i * 3] = (canvas[i * 3] ?? 0) * (1 - a) + s.color[0] * a;
        canvas[i * 3 + 1] = (canvas[i * 3 + 1] ?? 0) * (1 - a) + s.color[1] * a;
        canvas[i * 3 + 2] = (canvas[i * 3 + 2] ?? 0) * (1 - a) + s.color[2] * a;
        cov[i] = 0;
      }
    };

    generateStrokes(
      img,
      W,
      H,
      {
        brushSize: Number(p.brushSize),
        levels: Number(p.levels),
        detail: Number(p.detail) / 100,
        length: Number(p.length),
        curvature: Number(p.curvature) / 100,
        direction: p.direction === 'gradient' ? 'gradient' : 'flow',
        jitter: Number(p.jitter) / 100,
        seed,
        scale: sc,
        origin: ctx.origin,
      },
      p.direction === 'gradient' ? null : ctx.flow(),
      canvas,
      paint,
      (f) => {
        ctx.progress(f * 0.98);
      },
    );
    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const a = img[i * 4 + 3] ?? 0;
      out[i * 4] = (canvas[i * 3] ?? 0) * a;
      out[i * 4 + 1] = (canvas[i * 3 + 1] ?? 0) * a;
      out[i * 4 + 2] = (canvas[i * 3 + 2] ?? 0) * a;
      out[i * 4 + 3] = a;
    }
    return out;
  },
});
