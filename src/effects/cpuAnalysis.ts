// Analysekarten auf der CPU (Worker-Effekte) – gleiches Verfahren wie im Shader (analysis.wgsl) und im Dienst
// (ml-service/src/ml_service/analysis.py). Bilder: Float32Array RGBA, linear, vormultipliziert.

const encode = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(l, 0) ** (1 / 2.4) - 0.055);

/** Wahrgenommene Helligkeit 0..1 je Pixel (transparent = 0). */
export function luminance(img: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = img[i * 4 + 3] ?? 0;
    if (a <= 0) continue;
    const y =
      ((img[i * 4] ?? 0) * 0.2126 + (img[i * 4 + 1] ?? 0) * 0.7152 + (img[i * 4 + 2] ?? 0) * 0.0722) / a;
    out[i] = encode(Math.min(1, Math.max(0, y)));
  }
  return out;
}

function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.25) return src.slice();
  const r = Math.ceil(3 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const sum = k.reduce((a, b) => a + b, 0);
  const kk = k.map((v) => v / sum);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++)
        s += (kk[i + r] ?? 0) * (src[y * w + Math.min(w - 1, Math.max(0, x + i))] ?? 0);
      tmp[y * w + x] = s;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++)
        s += (kk[i + r] ?? 0) * (tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] ?? 0);
      out[y * w + x] = s;
    }
  return out;
}

/** Kantenkarte RGBA: r Stärke, gb Tangente (0.5 + 0.5·t), a Kohärenz. pxScale: Texel pro Original-px. */
export function edges(img: Float32Array, w: number, h: number, pxScale = 1): Float32Array {
  const lum = luminance(img, w, h);
  const at = (x: number, y: number) =>
    lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      gx[y * w + x] =
        ((at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x - 1, y) -
          at(x - 1, y + 1)) /
          8) *
        pxScale;
      gy[y * w + x] =
        ((at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x, y - 1) -
          at(x + 1, y - 1)) /
          8) *
        pxScale;
    }
  const sigma = Math.max(1.5, 6 * pxScale) / 3;
  const e = blur(
    gx.map((v) => v * v),
    w,
    h,
    sigma,
  );
  const f = blur(
    gx.map((v, i) => v * (gy[i] ?? 0)),
    w,
    h,
    sigma,
  );
  const g = blur(
    gy.map((v) => v * v),
    w,
    h,
    sigma,
  );
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const E = e[i] ?? 0;
    const F = f[i] ?? 0;
    const G = g[i] ?? 0;
    const d = Math.sqrt(Math.max((E - G) ** 2 + 4 * F * F, 0));
    const l1 = 0.5 * (E + G + d);
    const l2 = 0.5 * (E + G - d);
    let tx = l1 - E;
    let ty = -F;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-12) {
      tx /= tl;
      ty /= tl;
    } else {
      tx = 0;
      ty = 1;
    }
    out[i * 4] = Math.min(1, Math.hypot(gx[i] ?? 0, gy[i] ?? 0) * 8);
    out[i * 4 + 1] = 0.5 + 0.5 * tx;
    out[i * 4 + 2] = 0.5 + 0.5 * ty;
    out[i * 4 + 3] = l1 + l2 > 1e-12 ? (l1 - l2) / (l1 + l2) : 0;
  }
  return out;
}
