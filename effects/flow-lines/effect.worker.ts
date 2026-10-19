// Fließlinien: Startpunkte nach Dunkelheit (Zurückweisung auf einem festen Leinwandraster, Seed), von dort Stromlinien in
// beide Richtungen durch das Richtungsfeld (ctx.flow, Schritt 1 Render-px, Tangente vorzeichenstabil). Gezeichnet als
// geglättete Kapselsegmente mit auslaufenden Enden. Startpunkte in Leinwand-px → gleiche Linien in Vorschau und Export.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { encodeSrgb, paramColor, strokeSegment } from '../../src/effects/cpuHelpers';
import { mulberry32 } from '../../src/effects/random';

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const sc = ctx.scale;
    const [ox, oy] = ctx.origin;
    const [cw, ch] = ctx.canvasSize; // Render-px
    const flow = ctx.flow();
    const lum = ctx.luminance();
    // Anzahl bezieht sich auf 1 Megapixel Leinwand (gleiche Dichte bei jeder Bildgröße)
    const area = (cw / sc) * (ch / sc);
    const count = Math.max(1, Math.round(Number(p.lines) * Math.max(0.02, area / 1e6)));
    const len = Math.max(1, Number(p.length) * sc);
    const width = Math.max(0.2, Number(p.width) * sc);
    const density = Number(p.density) / 100;
    const taper = Number(p.taper) / 100;
    const imageColors = p.colorMode === 'image';
    const ink = paramColor(p.ink, [0.1, 0.1, 0.12]);
    const paper = paramColor(p.paper, [0.96, 0.94, 0.89]);

    const at = (x: number, y: number) =>
      Math.min(W - 1, Math.max(0, Math.floor(x))) + Math.min(H - 1, Math.max(0, Math.floor(y))) * W;
    // Dunkelheit (wahrgenommen) für die Startpunkte
    const dark = (x: number, y: number) => 1 - encodeSrgb(lum[at(x, y)] ?? 0);

    const cov = new Float32Array(W * H);
    const colR = imageColors ? new Float32Array(W * H) : null;
    const colG = imageColors ? new Float32Array(W * H) : null;
    const colB = imageColors ? new Float32Array(W * H) : null;
    const rand = mulberry32(Number(p.seed) >>> 0 || 1);
    const pts: number[] = [];
    let accepted = 0;
    for (let tries = 0; accepted < count && tries < count * 40; tries++) {
      // Leinwand-Koordinaten (unabhängig von Kachel und Auflösung)
      const lx = rand() * (cw / sc);
      const ly = rand() * (ch / sc);
      const u = rand();
      const x = lx * sc - ox;
      const y = ly * sc - oy;
      const inside = x >= -len && y >= -len && x < W + len && y < H + len;
      const d = inside ? dark(x, y) : 0.5;
      if (u > 1 - density + density * Math.pow(d, 1.4)) continue;
      accepted++;
      if (inside) pts.push(x, y);
    }
    ctx.progress(0.1);

    const tangent = (x: number, y: number): [number, number] => {
      const i = at(x, y) * 4;
      const tx = (flow[i + 1] ?? 0.5) * 2 - 1;
      const ty = (flow[i + 2] ?? 0.5) * 2 - 1;
      const l = Math.hypot(tx, ty);
      return l > 1e-4 ? [tx / l, ty / l] : [0, 1];
    };
    const steps = Math.max(2, Math.ceil(len / 2));
    for (let s = 0; s < pts.length; s += 2) {
      const sx = pts[s] ?? 0;
      const sy = pts[s + 1] ?? 0;
      const i0 = at(sx, sy) * 4;
      const a0 = img[i0 + 3] ?? 0;
      const cr = a0 > 0 ? (img[i0] ?? 0) / a0 : 0;
      const cg = a0 > 0 ? (img[i0 + 1] ?? 0) / a0 : 0;
      const cb = a0 > 0 ? (img[i0 + 2] ?? 0) / a0 : 0;
      const color =
        colR && colG && colB ? { r: colR, g: colG, b: colB, rgb: [cr, cg, cb] as const } : undefined;
      for (const dir of [1, -1]) {
        let x = sx;
        let y = sy;
        let [tx, ty] = tangent(x, y);
        tx *= dir;
        ty *= dir;
        for (let k = 0; k < steps; k++) {
          const nx = x + tx;
          const ny = y + ty;
          // Stärke läuft zum Ende aus
          const t = k / steps;
          const w = width * (1 - taper * t * t);
          strokeSegment(cov, W, H, x, y, nx, ny, w, 1, color);
          x = nx;
          y = ny;
          if (x < -len || y < -len || x > W + len || y > H + len) break;
          // in Lichtern auslaufen (je stärker die Dichte an die Helligkeit gebunden ist)
          if (density > 0 && dark(x, y) < density * 0.18) break;
          let [ux, uy] = tangent(x, y);
          if (ux * tx + uy * ty < 0) {
            ux = -ux;
            uy = -uy;
          }
          tx = ux;
          ty = uy;
        }
      }
      if ((s & 1023) === 0) ctx.progress(0.1 + (0.8 * s) / pts.length);
    }

    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const c = cov[i] ?? 0;
      const a = img[i * 4 + 3] ?? 0;
      const lr = colR ? (colR[i] ?? 0) : ink[0];
      const lg = colG ? (colG[i] ?? 0) : ink[1];
      const lb = colB ? (colB[i] ?? 0) : ink[2];
      out[i * 4] = (paper[0] * (1 - c) + lr * c) * a;
      out[i * 4 + 1] = (paper[1] * (1 - c) + lg * c) * a;
      out[i * 4 + 2] = (paper[2] * (1 - c) + lb * c) * a;
      out[i * 4 + 3] = a;
    }
    return out;
  },
});
