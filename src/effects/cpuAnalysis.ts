// Analysekarten auf der CPU (Worker-Effekte) – gleiches Verfahren wie im Shader (analysis.wgsl) und im Dienst
// (ml-service/src/ml_service/analysis.py). Bilder: Float32Array RGBA, linear, vormultipliziert.

import { FLOW_FAR_WEIGHT, FLOW_SIGMA_FAR, FLOW_SIGMA_NEAR } from './maps';

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

/** Sobel-Gradient je Original-px (wie sobel() in analysis.wgsl). */
function sobel(lum: Float32Array, w: number, h: number, pxScale: number): [Float32Array, Float32Array] {
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
  return [gx, gy];
}

/** Gauß; ab σ > 6 genähert durch drei Box-Filter (wie die GPU-Pyramide eine Näherung, gleiche Varianz). */
function blurAny(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 6) return blur(src, w, h, sigma);
  // drei gleiche Boxen der Breite 2r + 1: Varianz 3 · ((2r + 1)² − 1) / 12 = σ²
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  let cur = src;
  for (let k = 0; k < 3; k++) cur = boxBlur(cur, w, h, r);
  return cur;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const n = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[row + Math.min(w - 1, Math.max(0, i))] ?? 0;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += (src[row + Math.min(w - 1, x + r + 1)] ?? 0) - (src[row + Math.max(0, x - r)] ?? 0);
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, i)) * w + x] ?? 0;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += (tmp[Math.min(h - 1, y + r + 1) * w + x] ?? 0) - (tmp[Math.max(0, y - r) * w + x] ?? 0);
    }
  }
  return out;
}

/** Eigenzerlegung des Strukturtensors (E, F, G): Tangente (Einheitsvektor), λ1, Kohärenz. */
function tangentOf(
  E: number,
  F: number,
  G: number,
): { tx: number; ty: number; l1: number; coherence: number } {
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
  return { tx, ty, l1, coherence: l1 + l2 > 1e-12 ? (l1 - l2) / (l1 + l2) : 0 };
}

/** Kantenkarte RGBA: r Stärke, gb Tangente (0.5 + 0.5·t), a Kohärenz. pxScale: Texel pro Original-px. */
export function edges(img: Float32Array, w: number, h: number, pxScale = 1): Float32Array {
  const lum = luminance(img, w, h);
  const [gx, gy] = sobel(lum, w, h, pxScale);
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
    const t = tangentOf(e[i] ?? 0, f[i] ?? 0, g[i] ?? 0);
    out[i * 4] = Math.min(1, Math.hypot(gx[i] ?? 0, gy[i] ?? 0) * 8);
    out[i * 4 + 1] = 0.5 + 0.5 * t.tx;
    out[i * 4 + 2] = 0.5 + 0.5 * t.ty;
    out[i * 4 + 3] = t.coherence;
  }
  return out;
}

/**
 * Richtungsfeld RGBA (Analysekarte „flow“): r Feldstärke (√λ1 · 8), gb Tangente, a Kohärenz.
 * Strukturtensor geglättet mit σ = 6 und σ = 24 Original-px, J = J6 + ¼·J24 (wie analysis.wgsl `flow`).
 */
export function flow(img: Float32Array, w: number, h: number, pxScale = 1): Float32Array {
  const lum = luminance(img, w, h);
  const [gx, gy] = sobel(lum, w, h, pxScale);
  const comps = [gx.map((v) => v * v), gx.map((v, i) => v * (gy[i] ?? 0)), gy.map((v) => v * v)];
  const sNear = Math.max(1.5, FLOW_SIGMA_NEAR * 3 * pxScale) / 3;
  const sFar = Math.max(1.5, FLOW_SIGMA_FAR * 3 * pxScale) / 3;
  const near = comps.map((c) => blurAny(c, w, h, sNear));
  const far = comps.map((c) => blurAny(c, w, h, sFar));
  const [en, fn, gn] = near as [Float32Array, Float32Array, Float32Array];
  const [ef, ff, gf] = far as [Float32Array, Float32Array, Float32Array];
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = tangentOf(
      (en[i] ?? 0) + FLOW_FAR_WEIGHT * (ef[i] ?? 0),
      (fn[i] ?? 0) + FLOW_FAR_WEIGHT * (ff[i] ?? 0),
      (gn[i] ?? 0) + FLOW_FAR_WEIGHT * (gf[i] ?? 0),
    );
    out[i * 4] = Math.min(1, Math.sqrt(Math.max(t.l1, 0)) * 8);
    out[i * 4 + 1] = 0.5 + 0.5 * t.tx;
    out[i * 4 + 2] = 0.5 + 0.5 * t.ty;
    out[i * 4 + 3] = t.coherence;
  }
  return out;
}
