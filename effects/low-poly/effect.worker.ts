// Low-Poly (Vorschau, CPU): Punkte (points.ts) → Delaunay (delaunator) → Dreiecke rastern → Farbe je Dreieck.

import Delaunator from 'delaunator';
import { defineCpuEffect } from '../../src/effects/cpuApi';
import { lowPolyPoints } from './points';

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H, scale } = ctx;
    const [ox, oy] = ctx.origin;
    const wc = ctx.canvasSize[0] / scale;
    const hc = ctx.canvasSize[1] / scale;
    const edges = ctx.edges();
    const strengthAt = (x: number, y: number) => {
      const px = Math.min(W - 1, Math.max(0, Math.floor(x * scale - ox)));
      const py = Math.min(H - 1, Math.max(0, Math.floor(y * scale - oy)));
      return edges[(py * W + px) * 4] ?? 0;
    };
    const pts = lowPolyPoints(
      wc,
      hc,
      Math.round(Number(ctx.params.points)),
      Number(ctx.params.edgeWeight) / 100,
      ctx.seed,
      strengthAt,
    );
    ctx.progress(0.2);
    const tri = new Delaunator(pts).triangles;
    const nTri = tri.length / 3;
    // Dreieck je Pixel (Pixelmitte, Render-px)
    const owner = new Int32Array(W * H).fill(-1);
    const P = (k: number): [number, number] => [
      (pts[k * 2] ?? 0) * scale - ox,
      (pts[k * 2 + 1] ?? 0) * scale - oy,
    ];
    for (let t = 0; t < nTri; t++) {
      const a = P(tri[t * 3] ?? 0);
      const b = P(tri[t * 3 + 1] ?? 0);
      const c = P(tri[t * 3 + 2] ?? 0);
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6 && owner[y * W + x] === -1) owner[y * W + x] = t;
        }
      if (t % 2000 === 0) ctx.progress(0.2 + (0.5 * t) / nTri);
    }
    // Farbe je Dreieck
    const colors = new Float64Array(nTri * 5);
    if (String(ctx.params.color) === 'center') {
      for (let t = 0; t < nTri; t++) {
        const a = P(tri[t * 3] ?? 0);
        const b = P(tri[t * 3 + 1] ?? 0);
        const c = P(tri[t * 3 + 2] ?? 0);
        const x = Math.min(W - 1, Math.max(0, Math.floor((a[0] + b[0] + c[0]) / 3)));
        const y = Math.min(H - 1, Math.max(0, Math.floor((a[1] + b[1] + c[1]) / 3)));
        for (let k = 0; k < 4; k++) colors[t * 5 + k] = img[(y * W + x) * 4 + k] ?? 0;
        colors[t * 5 + 4] = 1;
      }
    } else {
      for (let i = 0; i < W * H; i++) {
        const t = owner[i] ?? -1;
        if (t < 0) continue;
        for (let k = 0; k < 4; k++) colors[t * 5 + k] = (colors[t * 5 + k] ?? 0) + (img[i * 4 + k] ?? 0);
        colors[t * 5 + 4] = (colors[t * 5 + 4] ?? 0) + 1;
      }
    }
    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const t = owner[i] ?? -1;
      if (t < 0) {
        for (let k = 0; k < 4; k++) out[i * 4 + k] = img[i * 4 + k] ?? 0;
        continue;
      }
      const n = Math.max(1, colors[t * 5 + 4] ?? 1);
      for (let k = 0; k < 4; k++) out[i * 4 + k] = (colors[t * 5 + k] ?? 0) / n;
    }
    ctx.progress(1);
    return out;
  },
});
