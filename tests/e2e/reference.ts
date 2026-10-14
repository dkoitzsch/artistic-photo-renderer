// CPU-Referenzen für Golden-Tests (gleiche Formeln wie die Shader).
import { PNG } from 'pngjs';

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Gauß-Unschärfe (σ = radius / 3) im linearen Raum, Kanten gespiegelt (Randpixel wiederholt). */
export function gaussianReference(img: PNG, radius: number): PNG {
  const { width: W, height: H } = img;
  const sigma = radius / 3;
  const r = Math.ceil(3 * sigma);
  const weights: number[] = [];
  let wsum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp((-i * i) / (2 * sigma * sigma));
    weights.push(w);
    wsum += w;
  }
  const mirror = (q: number, size: number) => {
    const period = 2 * size;
    let m = ((q % period) + period) % period;
    if (m >= size) m = period - 1 - m;
    return m;
  };
  const lin = new Float64Array(W * H * 3);
  for (let i = 0; i < W * H; i++)
    for (let c = 0; c < 3; c++) lin[i * 3 + c] = toLin((img.data[i * 4 + c] ?? 0) / 255);
  const tmp = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let i = -r; i <= r; i++)
          s += (weights[i + r] ?? 0) * (lin[(y * W + mirror(x + i, W)) * 3 + c] ?? 0);
        tmp[(y * W + x) * 3 + c] = s / wsum;
      }
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let i = -r; i <= r; i++)
          s += (weights[i + r] ?? 0) * (tmp[(mirror(y + i, H) * W + x) * 3 + c] ?? 0);
        out.data[(y * W + x) * 4 + c] = Math.round(toSrgb(s / wsum) * 255);
      }
      out.data[(y * W + x) * 4 + 3] = 255;
    }
  return out;
}
