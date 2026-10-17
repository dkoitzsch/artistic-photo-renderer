// Pixel-Sorting auf der CPU: je Zeile (bzw. Spalte) Spannen aus Pixeln im Helligkeitsbereich [lower, upper] bilden
// und jede Spanne nach dem Kriterium sortieren. Vormultipliziertes Arbeitsformat bleibt erhalten (Pixel werden nur umgestellt).

import { defineCpuEffect } from '../../src/effects/cpuApi';

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);

function key(r: number, g: number, b: number, a: number, criterion: string): number {
  if (a <= 0) return -1;
  const R = enc(r / a);
  const G = enc(g / a);
  const B = enc(b / a);
  if (criterion === 'luminance') return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const d = mx - mn;
  if (criterion === 'saturation') return mx > 0 ? d / mx : 0;
  if (d <= 0) return 0;
  let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  if (h < 0) h += 6;
  return h / 6;
}

export default defineCpuEffect({
  render(img, ctx) {
    const { width: W, height: H } = ctx;
    const dir = String(ctx.params.direction);
    const criterion = String(ctx.params.criterion);
    const lo = Number(ctx.params.lower) / 100;
    const hi = Number(ctx.params.upper) / 100;
    const minLen = Math.max(1, Math.round(Number(ctx.params.minLength) * ctx.scale));
    const vertical = dir === 'down' || dir === 'up';
    const reverse = dir === 'left' || dir === 'up';
    const lum = ctx.luminance();
    const out = img.slice();
    const lines = vertical ? W : H;
    const len = vertical ? H : W;
    const idx = (line: number, k: number) => (vertical ? k * W + line : line * W + k);
    const keys = new Float32Array(len);
    for (let line = 0; line < lines; line++) {
      let k = 0;
      while (k < len) {
        // Spanne: zusammenhängende Pixel im Helligkeitsbereich
        const v = lum[idx(line, k)] ?? 0;
        if (v < lo || v > hi) {
          k++;
          continue;
        }
        let end = k;
        while (end < len) {
          const w = lum[idx(line, end)] ?? 0;
          if (w < lo || w > hi) break;
          end++;
        }
        if (end - k >= minLen) {
          const order: number[] = [];
          for (let j = k; j < end; j++) {
            const i = idx(line, j) * 4;
            keys[j] = key(img[i] ?? 0, img[i + 1] ?? 0, img[i + 2] ?? 0, img[i + 3] ?? 0, criterion);
            order.push(j);
          }
          order.sort((a, b) => ((keys[a] ?? 0) - (keys[b] ?? 0)) * (reverse ? -1 : 1));
          order.forEach((src, n) => {
            const to = idx(line, k + n) * 4;
            const from = idx(line, src) * 4;
            for (let c = 0; c < 4; c++) out[to + c] = img[from + c] ?? 0;
          });
        }
        k = end;
      }
      if (line % 128 === 0) ctx.progress(line / lines);
    }
    return out;
  },
});
