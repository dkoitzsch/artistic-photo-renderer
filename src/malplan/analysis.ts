// Malplan-Analyse (läuft im Web Worker, rein und testbar): aus einem Bild (8-Bit-sRGB) werden vereinfachte Flächen
// gebildet – kantenerhaltende Glättung, Farbreduktion (k-Means in Oklab, „Anzahl Farben“), Zusammenhangskomponenten
// und Verschmelzen kleiner Flächen mit der ähnlichsten Nachbarfläche bis „Anzahl Formen“. Alle Hilfen (Werteskizze,
// Notan, Warm-Kalt, Kontur) leiten sich aus diesen Flächen ab.

import { mulberry32 } from '../effects/random';

export type Region = {
  /** mittlere Farbe in Oklab */
  lab: [number, number, number];
  /** mittlere Farbe sRGB 0..1 */
  rgb: [number, number, number];
  area: number;
};

export type Analysis = {
  width: number;
  height: number;
  /** Flächennummer je Pixel */
  labels: Int32Array;
  regions: Region[];
};

const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);

export function oklabFromLinear(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function linearFromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function srgbFromOklab(lab: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = linearFromOklab(lab[0], lab[1], lab[2]);
  const c = (v: number) => Math.min(1, Math.max(0, enc(v)));
  return [c(r), c(g), c(b)];
}

/** sRGB-RGBA (8 Bit) → Oklab je Pixel (3 Werte); transparente Pixel werden wie Weiß behandelt. */
export function toOklab(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  const lut = new Float32Array(256).map((_, i) => dec(i / 255));
  for (let i = 0; i < w * h; i++) {
    const a = (rgba[i * 4 + 3] ?? 255) / 255;
    const r = (lut[rgba[i * 4] ?? 0] ?? 0) * a + (1 - a);
    const g = (lut[rgba[i * 4 + 1] ?? 0] ?? 0) * a + (1 - a);
    const b = (lut[rgba[i * 4 + 2] ?? 0] ?? 0) * a + (1 - a);
    const lab = oklabFromLinear(r, g, b);
    out[i * 3] = lab[0];
    out[i * 3 + 1] = lab[1];
    out[i * 3 + 2] = lab[2];
  }
  return out;
}

/** Kantenerhaltende Glättung (bilateral, 5 × 5, Farbabstand in Oklab). */
export function smooth(lab: Float32Array, w: number, h: number, iterations = 2, sigmaR = 0.05): Float32Array {
  let cur = lab;
  const k = -0.5 / (sigmaR * sigmaR);
  const ks = -0.5 / (1.6 * 1.6);
  for (let it = 0; it < iterations; it++) {
    const out = new Float32Array(cur.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const L0 = cur[i] ?? 0;
        const a0 = cur[i + 1] ?? 0;
        const b0 = cur[i + 2] ?? 0;
        let sL = 0;
        let sa = 0;
        let sb = 0;
        let sw = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -2; dx <= 2; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const j = (yy * w + xx) * 3;
            const L = cur[j] ?? 0;
            const a = cur[j + 1] ?? 0;
            const b = cur[j + 2] ?? 0;
            const d2 = (L - L0) ** 2 + (a - a0) ** 2 + (b - b0) ** 2;
            const wt = Math.exp(d2 * k + (dx * dx + dy * dy) * ks);
            sL += L * wt;
            sa += a * wt;
            sb += b * wt;
            sw += wt;
          }
        }
        out[i] = sL / sw;
        out[i + 1] = sa / sw;
        out[i + 2] = sb / sw;
      }
    cur = out;
  }
  return cur;
}

/** k-Means in Oklab (k-Means++-Start mit festem Seed, Stichprobe); liefert Zentren und Zuordnung je Pixel. */
export function kmeans(
  lab: Float32Array,
  n: number,
  k: number,
  seed = 1,
  iterations = 14,
): { centers: Float32Array; assign: Uint16Array } {
  const rand = mulberry32(seed);
  const stride = Math.max(1, Math.floor(n / 60000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += stride) sample.push(i);
  const centers = new Float32Array(k * 3);
  const first = sample[Math.floor(rand() * sample.length)] ?? 0;
  centers.set(lab.subarray(first * 3, first * 3 + 3), 0);
  const dist = new Float64Array(sample.length).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    sample.forEach((p, si) => {
      const d =
        ((lab[p * 3] ?? 0) - (centers[(c - 1) * 3] ?? 0)) ** 2 +
        ((lab[p * 3 + 1] ?? 0) - (centers[(c - 1) * 3 + 1] ?? 0)) ** 2 +
        ((lab[p * 3 + 2] ?? 0) - (centers[(c - 1) * 3 + 2] ?? 0)) ** 2;
      if (d < (dist[si] ?? Infinity)) dist[si] = d;
      total += dist[si] ?? 0;
    });
    let r = rand() * total;
    let pick = sample[0] ?? 0;
    for (let si = 0; si < sample.length; si++) {
      r -= dist[si] ?? 0;
      if (r <= 0) {
        pick = sample[si] ?? 0;
        break;
      }
    }
    centers.set(lab.subarray(pick * 3, pick * 3 + 3), c * 3);
  }
  const nearest = (p: number) => {
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < k; c++) {
      const d =
        ((lab[p * 3] ?? 0) - (centers[c * 3] ?? 0)) ** 2 +
        ((lab[p * 3 + 1] ?? 0) - (centers[c * 3 + 1] ?? 0)) ** 2 +
        ((lab[p * 3 + 2] ?? 0) - (centers[c * 3 + 2] ?? 0)) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  for (let it = 0; it < iterations; it++) {
    const sum = new Float64Array(k * 4);
    for (const p of sample) {
      const c = nearest(p);
      sum[c * 4] = (sum[c * 4] ?? 0) + (lab[p * 3] ?? 0);
      sum[c * 4 + 1] = (sum[c * 4 + 1] ?? 0) + (lab[p * 3 + 1] ?? 0);
      sum[c * 4 + 2] = (sum[c * 4 + 2] ?? 0) + (lab[p * 3 + 2] ?? 0);
      sum[c * 4 + 3] = (sum[c * 4 + 3] ?? 0) + 1;
    }
    for (let c = 0; c < k; c++) {
      const m = sum[c * 4 + 3] ?? 0;
      if (m > 0) for (let j = 0; j < 3; j++) centers[c * 3 + j] = (sum[c * 4 + j] ?? 0) / m;
    }
  }
  const assign = new Uint16Array(n);
  for (let p = 0; p < n; p++) assign[p] = nearest(p);
  return { centers, assign };
}

/** Zusammenhangskomponenten (4er-Nachbarschaft) gleicher Werte; liefert Nummer je Pixel und Anzahl. */
export function components(
  values: ArrayLike<number>,
  w: number,
  h: number,
): { comp: Int32Array; count: number } {
  const comp = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if ((comp[start] ?? 0) >= 0) continue;
    const v = values[start];
    let top = 0;
    stack[top++] = start;
    comp[start] = count;
    while (top > 0) {
      const p = stack[--top] ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if ((comp[q] ?? 0) < 0 && values[q] === v) {
          comp[q] = count;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    count++;
  }
  return { comp, count };
}

/** Kleiner binärer Min-Heap über (Schlüssel, Wert). */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] ?? 0) <= key) break;
      k[i] = k[p] ?? 0;
      v[i] = v[p] ?? 0;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] | null {
    const k = this.keys;
    const v = this.vals;
    if (k.length === 0) return null;
    const top: [number, number] = [k[0] ?? 0, v[0] ?? 0];
    const lk = k.pop() ?? 0;
    const lv = v.pop() ?? 0;
    if (k.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lk;
        if (l < k.length && (k[l] ?? 0) < mk) {
          m = l;
          mk = k[l] ?? 0;
        }
        if (r < k.length && (k[r] ?? 0) < mk) m = r;
        if (m === i) break;
        k[i] = k[m] ?? 0;
        v[i] = v[m] ?? 0;
        i = m;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/**
 * Verschmilzt Flächen, bis höchstens `target` übrig sind und keine kleiner als minArea Pixel ist: immer die kleinste
 * Fläche mit der farblich ähnlichsten Nachbarfläche (lange gemeinsame Grenzen werden bevorzugt).
 */
export function mergeRegions(
  comp: Int32Array,
  count: number,
  lab: Float32Array,
  w: number,
  h: number,
  target: number,
  minArea: number,
): Analysis {
  const sum = new Float64Array(count * 3);
  const area = new Float64Array(count);
  for (let p = 0; p < w * h; p++) {
    const c = comp[p] ?? 0;
    sum[c * 3] = (sum[c * 3] ?? 0) + (lab[p * 3] ?? 0);
    sum[c * 3 + 1] = (sum[c * 3 + 1] ?? 0) + (lab[p * 3 + 1] ?? 0);
    sum[c * 3 + 2] = (sum[c * 3 + 2] ?? 0) + (lab[p * 3 + 2] ?? 0);
    area[c] = (area[c] ?? 0) + 1;
  }
  // Nachbarschaft mit Grenzlänge
  const adj: Map<number, number>[] = Array.from({ length: count }, () => new Map<number, number>());
  const link = (a: number, b: number) => {
    if (a === b) return;
    const ma = adj[a];
    const mb = adj[b];
    if (!ma || !mb) return;
    ma.set(b, (ma.get(b) ?? 0) + 1);
    mb.set(a, (mb.get(a) ?? 0) + 1);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x < w - 1) link(comp[p] ?? 0, comp[p + 1] ?? 0);
      if (y < h - 1) link(comp[p] ?? 0, comp[p + w] ?? 0);
    }
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (a: number): number => {
    let r = a;
    while ((parent[r] ?? r) !== r) r = parent[r] ?? r;
    let c = a;
    while ((parent[c] ?? c) !== r) {
      const n = parent[c] ?? c;
      parent[c] = r;
      c = n;
    }
    return r;
  };
  const heap = new Heap();
  for (let c = 0; c < count; c++) heap.push(area[c] ?? 0, c);
  let active = count;
  for (;;) {
    const top = heap.pop();
    if (!top) break;
    const [a, r] = top;
    if (find(r) !== r || (area[r] ?? 0) !== a) continue; // veraltet
    if (active <= target && a >= minArea) break;
    const nb = adj[r];
    if (!nb || nb.size === 0) continue;
    const ar = area[r] ?? 1;
    const Lr = (sum[r * 3] ?? 0) / ar;
    const Ar = (sum[r * 3 + 1] ?? 0) / ar;
    const Br = (sum[r * 3 + 2] ?? 0) / ar;
    let best = -1;
    let bestCost = Infinity;
    for (const [n, len] of nb) {
      const an = area[n] ?? 1;
      const d = Math.sqrt(
        ((sum[n * 3] ?? 0) / an - Lr) ** 2 +
          ((sum[n * 3 + 1] ?? 0) / an - Ar) ** 2 +
          ((sum[n * 3 + 2] ?? 0) / an - Br) ** 2,
      );
      // lange gemeinsame Grenze → eher zusammengehörig
      const cost = d / (1 + Math.log1p(len) * 0.15);
      if (cost < bestCost) {
        bestCost = cost;
        best = n;
      }
    }
    if (best < 0) continue;
    // r in best aufgehen lassen
    parent[r] = best;
    area[best] = (area[best] ?? 0) + ar;
    for (let j = 0; j < 3; j++) sum[best * 3 + j] = (sum[best * 3 + j] ?? 0) + (sum[r * 3 + j] ?? 0);
    const mb = adj[best];
    if (mb) {
      mb.delete(r);
      for (const [n, len] of nb) {
        if (n === best) continue;
        mb.set(n, (mb.get(n) ?? 0) + len);
        const mn = adj[n];
        if (mn) {
          mn.delete(r);
          mn.set(best, (mn.get(best) ?? 0) + len);
        }
      }
    }
    adj[r] = new Map();
    active--;
    heap.push(area[best] ?? 0, best);
  }
  // Nummern verdichten
  const index = new Int32Array(count).fill(-1);
  const regions: Region[] = [];
  const labels = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const r = find(comp[p] ?? 0);
    let id = index[r] ?? -1;
    if (id < 0) {
      id = regions.length;
      index[r] = id;
      const ar = area[r] ?? 1;
      const lab3: [number, number, number] = [
        (sum[r * 3] ?? 0) / ar,
        (sum[r * 3 + 1] ?? 0) / ar,
        (sum[r * 3 + 2] ?? 0) / ar,
      ];
      regions.push({ lab: lab3, rgb: srgbFromOklab(lab3), area: ar });
    }
    labels[p] = id;
  }
  return { width: w, height: h, labels, regions };
}

/** Komplette Flächenanalyse eines Bildes. */
export function analyze(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  opts: { shapes: number; colors: number; seed?: number },
  progress: (p: number) => void = () => undefined,
): Analysis {
  const lab0 = toOklab(rgba, w, h);
  progress(0.1);
  const lab = smooth(lab0, w, h, 2);
  progress(0.35);
  const { assign } = kmeans(lab, w * h, Math.max(2, opts.colors), opts.seed ?? 1);
  progress(0.55);
  const { comp, count } = components(assign, w, h);
  progress(0.65);
  // Mindestfläche: ein Bruchteil der mittleren Formgröße, damit keine Krümel bleiben
  const minArea = Math.max(4, (w * h) / Math.max(1, opts.shapes) / 12);
  const result = mergeRegions(comp, count, lab, w, h, Math.max(1, opts.shapes), minArea);
  progress(0.9);
  return result;
}

/** Ordnet jeder Fläche eine Tonwertstufe zu (1-D-k-Means auf L, flächengewichtet); 0 = dunkelste Stufe. */
export function valueLevels(a: Analysis, levels: number): { level: Uint8Array; tones: number[] } {
  const L = a.regions.map((r) => r.lab[0]);
  const wts = a.regions.map((r) => r.area);
  const lo = Math.min(...L);
  const hi = Math.max(...L);
  let centers = Array.from({ length: levels }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / levels);
  for (let it = 0; it < 30; it++) {
    const s = new Array<number>(levels).fill(0);
    const n = new Array<number>(levels).fill(0);
    L.forEach((v, i) => {
      let best = 0;
      for (let c = 1; c < levels; c++)
        if (Math.abs(v - (centers[c] ?? 0)) < Math.abs(v - (centers[best] ?? 0))) best = c;
      s[best] = (s[best] ?? 0) + v * (wts[i] ?? 0);
      n[best] = (n[best] ?? 0) + (wts[i] ?? 0);
    });
    centers = centers.map((c, i) => ((n[i] ?? 0) > 0 ? (s[i] ?? 0) / (n[i] ?? 1) : c));
  }
  centers.sort((x, y) => x - y);
  const level = new Uint8Array(a.regions.length);
  L.forEach((v, i) => {
    let best = 0;
    for (let c = 1; c < levels; c++)
      if (Math.abs(v - (centers[c] ?? 0)) < Math.abs(v - (centers[best] ?? 0))) best = c;
    level[i] = best;
  });
  return { level, tones: centers };
}

/**
 * Stufenbild je Pixel aus einer Stufe je Fläche; Inseln unter minPixels gehen in der häufigsten Nachbarstufe auf
 * (Vereinfachung kleiner Flächen, Spec 7.3).
 */
export function levelMap(a: Analysis, levelOfRegion: ArrayLike<number>, minPixels: number): Uint8Array {
  const { width: w, height: h, labels } = a;
  const map = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) map[p] = levelOfRegion[labels[p] ?? 0] ?? 0;
  if (minPixels <= 1) return map;
  for (let pass = 0; pass < 3; pass++) {
    const { comp, count } = components(map, w, h);
    const size = new Int32Array(count);
    for (let p = 0; p < w * h; p++) size[comp[p] ?? 0] = (size[comp[p] ?? 0] ?? 0) + 1;
    // Stimmen der Nachbarstufen je kleiner Insel
    const votes = new Map<number, Map<number, number>>();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const c = comp[p] ?? 0;
        if ((size[c] ?? 0) >= minPixels) continue;
        const vote = (q: number) => {
          if ((comp[q] ?? 0) === c) return;
          let m = votes.get(c);
          if (!m) {
            m = new Map();
            votes.set(c, m);
          }
          const lv = map[q] ?? 0;
          m.set(lv, (m.get(lv) ?? 0) + 1);
        };
        if (x > 0) vote(p - 1);
        if (x < w - 1) vote(p + 1);
        if (y > 0) vote(p - w);
        if (y < h - 1) vote(p + w);
      }
    if (votes.size === 0) break;
    const target = new Map<number, number>();
    for (const [c, m] of votes) {
      let best = -1;
      let bv = -1;
      for (const [lv, n] of m)
        if (n > bv) {
          bv = n;
          best = lv;
        }
      target.set(c, best);
    }
    for (let p = 0; p < w * h; p++) {
      const t = target.get(comp[p] ?? 0);
      if (t !== undefined) map[p] = t;
    }
  }
  return map;
}

/** Notan: hell (1) oder dunkel (0) je Fläche nach wahrgenommener Helligkeit (Oklab L) gegen die Schwelle. */
export function notanOfRegions(a: Analysis, threshold: number): Uint8Array {
  return Uint8Array.from(a.regions, (r) => (r.lab[0] >= threshold ? 1 : 0));
}

/** Median-Helligkeit (Oklab L) flächengewichtet – guter Startwert für die Notan-Schwelle. */
export function medianLightness(a: Analysis): number {
  const list = a.regions.map((r) => [r.lab[0], r.area] as const).sort((x, y) => x[0] - y[0]);
  const half = list.reduce((s, r) => s + r[1], 0) / 2;
  let acc = 0;
  for (const [L, n] of list) {
    acc += n;
    if (acc >= half) return L;
  }
  return 0.5;
}

/**
 * Wärme einer Farbe −1 (kalt) … +1 (warm), unabhängig von der Helligkeit: Buntheit in Richtung Orange (OKLCh-Farbton
 * ≈ 60°) gegen Richtung Blau-Cyan; Graustufen sind neutral.
 */
export function warmth(lab: readonly [number, number, number]): number {
  const a = lab[1];
  const b = lab[2];
  const chroma = Math.hypot(a, b);
  if (chroma < 1e-4) return 0;
  const hue = Math.atan2(b, a);
  const axis = (60 * Math.PI) / 180;
  return Math.max(-1, Math.min(1, (Math.cos(hue - axis) * chroma) / 0.12));
}

/**
 * Konturen: Grenzen zwischen verschiedenen Flächen als Polylinien entlang der Pixelkanten, geglättet
 * (Douglas-Peucker, dann Chaikin). Koordinaten normiert (x / Breite, y / Höhe). Der Bildrand gehört nicht dazu.
 */
export function contours(labels: ArrayLike<number>, w: number, h: number, tolerance = 0.8): Float32Array[] {
  // Kanten: waagerecht H(x, y) zwischen (x, y−1) und (x, y) für x < w, 1 ≤ y < h; senkrecht V(x, y) zwischen
  // (x−1, y) und (x, y) für 1 ≤ x < w, y < h. Ecken (x, y) mit 0 ≤ x ≤ w, 0 ≤ y ≤ h.
  const H = new Uint8Array(w * (h + 1));
  const V = new Uint8Array((w + 1) * h);
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) if (labels[y * w + x] !== labels[(y - 1) * w + x]) H[y * w + x] = 1;
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) if (labels[y * w + x] !== labels[y * w + x - 1]) V[y * (w + 1) + x] = 1;
  const W1 = w + 1;
  const degree = (cx: number, cy: number) =>
    (cx > 0 ? (H[cy * w + cx - 1] ?? 0) : 0) +
    (cx < w ? (H[cy * w + cx] ?? 0) : 0) +
    (cy > 0 ? (V[(cy - 1) * W1 + cx] ?? 0) : 0) +
    (cy < h ? (V[cy * W1 + cx] ?? 0) : 0);
  /** nächste unbesuchte Kante ab Ecke; markiert sie und liefert die Zielecke */
  const step = (cx: number, cy: number): [number, number] | null => {
    if (cx < w && H[cy * w + cx]) {
      H[cy * w + cx] = 0;
      return [cx + 1, cy];
    }
    if (cx > 0 && H[cy * w + cx - 1]) {
      H[cy * w + cx - 1] = 0;
      return [cx - 1, cy];
    }
    if (cy < h && V[cy * W1 + cx]) {
      V[cy * W1 + cx] = 0;
      return [cx, cy + 1];
    }
    if (cy > 0 && V[(cy - 1) * W1 + cx]) {
      V[(cy - 1) * W1 + cx] = 0;
      return [cx, cy - 1];
    }
    return null;
  };
  const deg0 = new Uint8Array(W1 * (h + 1));
  for (let cy = 0; cy <= h; cy++) for (let cx = 0; cx <= w; cx++) deg0[cy * W1 + cx] = degree(cx, cy);
  const lines: { pts: number[]; closed: boolean }[] = [];
  const walk = (sx: number, sy: number) => {
    let cur: [number, number] = [sx, sy];
    const pts: number[] = [sx, sy];
    for (;;) {
      const next = step(cur[0], cur[1]);
      if (!next) break;
      pts.push(next[0], next[1]);
      cur = next;
      // an Kreuzungen und Enden (Grad ≠ 2) anhalten; Ringe enden wieder am Start
      if ((deg0[cur[1] * W1 + cur[0]] ?? 0) !== 2) break;
    }
    const closed = pts.length > 4 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
    if (pts.length >= 4) lines.push({ pts, closed });
  };
  // zuerst von Kreuzungen und Enden aus, dann die übrigen geschlossenen Ringe
  for (let cy = 0; cy <= h; cy++)
    for (let cx = 0; cx <= w; cx++) {
      const d = deg0[cy * W1 + cx] ?? 0;
      if (d === 0 || d === 2) continue;
      for (let k = 0; k < d; k++) walk(cx, cy);
    }
  for (let cy = 0; cy <= h; cy++) for (let cx = 0; cx <= w; cx++) if (degree(cx, cy) > 0) walk(cx, cy);
  return lines
    .map(({ pts, closed }) => {
      const simple = douglasPeucker(pts, tolerance);
      const smoothPts = chaikin(simple, 2, closed);
      const out = new Float32Array(smoothPts.length);
      for (let i = 0; i < smoothPts.length; i += 2) {
        out[i] = (smoothPts[i] ?? 0) / w;
        out[i + 1] = (smoothPts[i + 1] ?? 0) / h;
      }
      return out;
    })
    .filter((l) => l.length >= 4);
}

/** Douglas-Peucker auf einer Polylinie [x0, y0, x1, y1, …]. */
export function douglasPeucker(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() ?? [0, 0];
    const ax = pts[a * 2] ?? 0;
    const ay = pts[a * 2 + 1] ?? 0;
    const bx = pts[b * 2] ?? 0;
    const by = pts[b * 2 + 1] ?? 0;
    const len = Math.hypot(bx - ax, by - ay);
    let best = -1;
    let bd = eps;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] ?? 0;
      const py = pts[i * 2 + 1] ?? 0;
      const d =
        len > 1e-9
          ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
          : Math.hypot(px - ax, py - ay);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2] ?? 0, pts[i * 2 + 1] ?? 0);
  return out;
}

/** Chaikin-Glättung; Endpunkte offener Linien bleiben fest. */
export function chaikin(pts: number[], iterations: number, closed: boolean): number[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length / 2;
    if (n < 3) return cur;
    const out: number[] = [];
    if (!closed) out.push(cur[0] ?? 0, cur[1] ?? 0);
    const segs = closed ? n - 1 : n - 1;
    for (let i = 0; i < segs; i++) {
      const ax = cur[i * 2] ?? 0;
      const ay = cur[i * 2 + 1] ?? 0;
      const bx = cur[i * 2 + 2] ?? 0;
      const by = cur[i * 2 + 3] ?? 0;
      out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    if (!closed) out.push(cur[(n - 1) * 2] ?? 0, cur[(n - 1) * 2 + 1] ?? 0);
    else out.push(out[0] ?? 0, out[1] ?? 0);
    cur = out;
  }
  return cur;
}
