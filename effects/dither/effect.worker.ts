// Dithering auf der CPU (ganze Ebene am Stück): Bild auf ein Blockraster in Leinwand-Koordinaten mitteln, in sRGB
// quantisieren (Fehlerdiffusion oder geordnete Schwelle), Blöcke zurück auf die Pixel.

import { defineCpuEffect } from '../../src/effects/cpuApi';
import { bayer, blueNoise } from './blueNoise';

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((Math.max(0, c) + 0.055) / 1.055) ** 2.4);

const METHODS = ['floyd-steinberg', 'atkinson', 'bayer-2', 'bayer-4', 'bayer-8', 'blue-noise'];

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const p = ctx.params;
    const method = METHODS.indexOf(String(p.method));
    const mode = String(p.colors);
    const levels = Math.max(2, Math.round(Number(p.levels)));
    const palette = (Array.isArray(p.palette) ? (p.palette as number[][]) : []).filter((c) => c.length === 3);
    const block = Math.max(1, Number(p.pixelSize) * ctx.scale); // Render-px je Block
    const [ox, oy] = ctx.origin;
    const bx0 = Math.floor(ox / block);
    const by0 = Math.floor(oy / block);
    const BW = Math.floor((ox + W - 1) / block) - bx0 + 1;
    const BH = Math.floor((oy + H - 1) / block) - by0 + 1;

    // 1. Mittelwert je Block (linear, vormultipliziert) → sRGB, gerades Alpha
    const acc = new Float64Array(BW * BH * 5);
    for (let y = 0; y < H; y++) {
      const by = Math.floor((y + oy) / block) - by0;
      for (let x = 0; x < W; x++) {
        const b = (by * BW + (Math.floor((x + ox) / block) - bx0)) * 5;
        const i = (y * W + x) * 4;
        for (let c = 0; c < 4; c++) acc[b + c] = (acc[b + c] ?? 0) + (img[i + c] ?? 0);
        acc[b + 4] = (acc[b + 4] ?? 0) + 1;
      }
    }
    const col = new Float32Array(BW * BH * 3);
    for (let b = 0; b < BW * BH; b++) {
      const n = Math.max(1, acc[b * 5 + 4] ?? 0);
      const a = (acc[b * 5 + 3] ?? 0) / n;
      for (let c = 0; c < 3; c++)
        col[b * 3 + c] = a > 0 ? enc(Math.min(1, (acc[b * 5 + c] ?? 0) / n / a)) : 1;
      if (mode === 'mono') {
        const l =
          0.2126 * (col[b * 3] ?? 0) + 0.7152 * (col[b * 3 + 1] ?? 0) + 0.0722 * (col[b * 3 + 2] ?? 0);
        col.fill(l, b * 3, b * 3 + 3);
      }
    }
    ctx.progress(0.3);

    // 2. Quantisierung
    const quant = (r: number, g: number, b: number): [number, number, number] => {
      if (mode === 'palette' && palette.length) {
        let best = palette[0] ?? [0, 0, 0];
        let bd = Infinity;
        for (const c of palette) {
          const d = ((c[0] ?? 0) - r) ** 2 + ((c[1] ?? 0) - g) ** 2 + ((c[2] ?? 0) - b) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        return [best[0] ?? 0, best[1] ?? 0, best[2] ?? 0];
      }
      const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * (levels - 1)) / (levels - 1);
      return [q(r), q(g), q(b)];
    };
    const out = new Float32Array(BW * BH * 3);
    if (method <= 1) {
      // Fehlerdiffusion
      const kernel =
        method === 0
          ? [
              [1, 0, 7 / 16],
              [-1, 1, 3 / 16],
              [0, 1, 5 / 16],
              [1, 1, 1 / 16],
            ]
          : [
              [1, 0, 1 / 8],
              [2, 0, 1 / 8],
              [-1, 1, 1 / 8],
              [0, 1, 1 / 8],
              [1, 1, 1 / 8],
              [0, 2, 1 / 8],
            ];
      const work = col.slice();
      for (let y = 0; y < BH; y++) {
        const rev = p.serpentine === true && y % 2 === 1;
        for (let k = 0; k < BW; k++) {
          const x = rev ? BW - 1 - k : k;
          const i = (y * BW + x) * 3;
          const q = quant(work[i] ?? 0, work[i + 1] ?? 0, work[i + 2] ?? 0);
          for (let c = 0; c < 3; c++) {
            out[i + c] = q[c] ?? 0;
            const err = (work[i + c] ?? 0) - (q[c] ?? 0);
            for (const [dx = 0, dy = 0, w = 0] of kernel) {
              const nx = x + (rev ? -dx : dx);
              const ny = y + dy;
              if (nx < 0 || nx >= BW || ny >= BH) continue;
              const j = (ny * BW + nx) * 3 + c;
              work[j] = (work[j] ?? 0) + err * w;
            }
          }
        }
        if (y % 64 === 0) ctx.progress(0.3 + (0.6 * y) / BH);
      }
    } else {
      // geordnet: Schwelle aus Bayer- bzw. Blue-Noise-Matrix, im Leinwandraster verankert
      const size = method === 2 ? 2 : method === 3 ? 4 : method === 4 ? 8 : 64;
      const m = method === 5 ? blueNoise(64) : bayer(size);
      const spread = mode === 'palette' ? 0.5 : 1 / (levels - 1);
      for (let y = 0; y < BH; y++)
        for (let x = 0; x < BW; x++) {
          const gx = (((x + bx0) % size) + size) % size;
          const gy = (((y + by0) % size) + size) % size;
          const t = ((m[gy * size + gx] ?? 0.5) - 0.5) * spread;
          const i = (y * BW + x) * 3;
          const q = quant((col[i] ?? 0) + t, (col[i + 1] ?? 0) + t, (col[i + 2] ?? 0) + t);
          out.set(q, i);
        }
    }
    ctx.progress(0.9);

    // 3. zurück auf die Pixel (Alpha je Pixel bleibt)
    const result = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const by = Math.floor((y + oy) / block) - by0;
      for (let x = 0; x < W; x++) {
        const b = (by * BW + (Math.floor((x + ox) / block) - bx0)) * 3;
        const i = (y * W + x) * 4;
        const a = img[i + 3] ?? 0;
        for (let c = 0; c < 3; c++) result[i + c] = dec(out[b + c] ?? 0) * a;
        result[i + 3] = a;
      }
    }
    return result;
  },
});
