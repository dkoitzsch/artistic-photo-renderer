// Test-Effekt (Browser-CPU): Farben invertieren (sRGB), optional Seed-Rauschen und künstliche Verzögerung.
import { defineCpuEffect } from '../../../src/effects/cpuApi';

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((Math.max(0, c) + 0.055) / 1.055) ** 2.4);

export default defineCpuEffect({
  async render(img, ctx) {
    const delay = Number(ctx.params.delay);
    const noise = Number(ctx.params.noise);
    for (let i = 0; i < 20; i++) {
      ctx.progress(i / 20);
      if (delay > 0) await new Promise((r) => setTimeout(r, (delay * 1000) / 20));
    }
    const out = new Float32Array(img.length);
    for (let y = 0; y < ctx.height; y++)
      for (let x = 0; x < ctx.width; x++) {
        const i = (y * ctx.width + x) * 4;
        const a = img[i + 3] ?? 0;
        const n = noise > 0 ? noise * (ctx.rand(x, y, 0) - 0.5) : 0;
        for (let c = 0; c < 3; c++) {
          const v = a > 0 ? (img[i + c] ?? 0) / a : 0;
          out[i + c] = dec(Math.min(1, Math.max(0, 1 - enc(v) + n))) * a;
        }
        out[i + 3] = a;
      }
    return out;
  },
});
