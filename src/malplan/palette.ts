// Reduzierte Palette, Mischrezepte und Farbfeld-Karte (Spec „Effekte“ 7.4): Flächenfarben werden flächengewichtet auf
// „Anzahl Farben“ zusammengefasst (k-Means in Oklab), je Farbe sucht die Pigment-Engine ein Rezept aus „Meine Farben“;
// jede Fläche bekommt die gemischte Farbe ihres Paletteneintrags. Rein (läuft im Malplan-Worker), getestet.

import { mulberry32 } from '../effects/random';
import { findMix, type Recipe } from '../pigments/engine';
import { linearFromOklab, oklabFromLinear, type Analysis } from './analysis';

export type PaletteEntry = {
  /** Nummer in der Farbfeld-Karte (1 … N, dunkel → hell) */
  number: number;
  /** Zielfarbe (Mittel der Flächen) sRGB 0…1 */
  target: [number, number, number];
  /** gemischte Farbe sRGB 0…1 */
  mixed: [number, number, number];
  recipe: { id: string; fraction: number }[];
  deltaE: number;
  /** Anteil an der Bildfläche 0…1 */
  share: number;
};

export type Palette = {
  entries: PaletteEntry[];
  /** Paletteneintrag (Index in entries) je Fläche */
  regionEntry: Int32Array;
  /** Beschriftungspunkt je Fläche: x, y, Abstand zum Rand (px) */
  labelPoints: Float32Array;
};

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const srgbOfLab = (lab: readonly number[]): [number, number, number] =>
  linearFromOklab(lab[0] ?? 0, lab[1] ?? 0, lab[2] ?? 0).map((v) => Math.min(1, Math.max(0, enc(v)))) as [
    number,
    number,
    number,
  ];

/** Flächengewichtetes k-Means der Flächenfarben (Oklab); liefert Zentren und Zuordnung je Fläche. */
export function clusterRegions(
  a: Analysis,
  count: number,
  seed = 1,
): { centers: [number, number, number][]; assign: Int32Array } {
  const regs = a.regions;
  const k = Math.max(1, Math.min(count, regs.length));
  const rand = mulberry32(seed);
  const centers: [number, number, number][] = [];
  // k-means++ (flächengewichtet)
  const first = regs.reduce((best, r, i) => (r.area > (regs[best]?.area ?? 0) ? i : best), 0);
  centers.push([...(regs[first]?.lab ?? [0, 0, 0])] as [number, number, number]);
  const d2 = (lab: readonly number[], c: readonly number[]) =>
    ((lab[0] ?? 0) - (c[0] ?? 0)) ** 2 +
    ((lab[1] ?? 0) - (c[1] ?? 0)) ** 2 +
    ((lab[2] ?? 0) - (c[2] ?? 0)) ** 2;
  while (centers.length < k) {
    const w = regs.map((r) => r.area * Math.min(...centers.map((c) => d2(r.lab, c))));
    const total = w.reduce((s, v) => s + v, 0);
    if (total <= 0) break;
    let x = rand() * total;
    let pick = regs.length - 1;
    for (let i = 0; i < w.length; i++) {
      x -= w[i] ?? 0;
      if (x <= 0) {
        pick = i;
        break;
      }
    }
    centers.push([...(regs[pick]?.lab ?? [0, 0, 0])] as [number, number, number]);
  }
  const assign = new Int32Array(regs.length);
  for (let it = 0; it < 20; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    regs.forEach((r, i) => {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = d2(r.lab, c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      assign[i] = best;
      const s = sum[best];
      if (!s) return;
      s[0] = (s[0] ?? 0) + r.lab[0] * r.area;
      s[1] = (s[1] ?? 0) + r.lab[1] * r.area;
      s[2] = (s[2] ?? 0) + r.lab[2] * r.area;
      s[3] = (s[3] ?? 0) + r.area;
    });
    centers.forEach((c, j) => {
      const s = sum[j];
      if (!s || !s[3]) return;
      c[0] = (s[0] ?? 0) / s[3];
      c[1] = (s[1] ?? 0) / s[3];
      c[2] = (s[2] ?? 0) / s[3];
    });
  }
  return { centers, assign };
}

/**
 * Beschriftungspunkt je Fläche: der Pixel mit dem größten Abstand zum Flächenrand (Chamfer-Distanztransformation 3-4).
 */
export function labelPoints(labels: Int32Array, w: number, h: number, regionCount: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i];
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        labels[i - 1] !== l ||
        labels[i + 1] !== l ||
        labels[i - w] !== l ||
        labels[i + w] !== l;
      d[i] = edge ? 1 : INF;
    }
  const at = (i: number) => d[i] ?? INF;
  for (let y = 1; y < h; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      d[i] = Math.min(at(i), at(i - 1) + 1, at(i - w) + 1, at(i - w - 1) + 1.4, at(i - w + 1) + 1.4);
    }
  for (let y = h - 2; y >= 0; y--)
    for (let x = w - 2; x >= 1; x--) {
      const i = y * w + x;
      d[i] = Math.min(at(i), at(i + 1) + 1, at(i + w) + 1, at(i + w + 1) + 1.4, at(i + w - 1) + 1.4);
    }
  const out = new Float32Array(regionCount * 3);
  for (let i = 0; i < w * h; i++) {
    const r = labels[i] ?? -1;
    if (r < 0 || r >= regionCount) continue;
    if ((d[i] ?? 0) > (out[r * 3 + 2] ?? 0)) {
      out[r * 3] = (i % w) + 0.5;
      out[r * 3 + 1] = Math.floor(i / w) + 0.5;
      out[r * 3 + 2] = d[i] ?? 0;
    }
  }
  return out;
}

/** Reduzierte Palette mit Rezepten aus „Meine Farben“ für eine Flächenanalyse. */
export function buildPalette(a: Analysis, count: number, myColors: readonly string[]): Palette {
  const { centers, assign } = clusterRegions(a, count);
  const total = a.regions.reduce((s, r) => s + r.area, 0) || 1;
  const shares = centers.map(() => 0);
  a.regions.forEach((r, i) => {
    const j = assign[i] ?? 0;
    shares[j] = (shares[j] ?? 0) + r.area / total;
  });
  const raw = centers.map((c, j) => {
    const target = srgbOfLab(c);
    const recipe: Recipe = findMix(target, myColors);
    return {
      target,
      mixed: recipe.result.srgb,
      recipe: recipe.parts,
      deltaE: recipe.deltaE,
      share: shares[j] ?? 0,
      L: c[0],
      index: j,
    };
  });
  // dunkel → hell nummerieren
  const order = raw.slice().sort((x, y) => x.L - y.L);
  const remap = new Int32Array(centers.length);
  order.forEach((e, n) => {
    remap[e.index] = n;
  });
  const entries: PaletteEntry[] = order.map((e, n) => ({
    number: n + 1,
    target: e.target,
    mixed: e.mixed,
    recipe: e.recipe,
    deltaE: e.deltaE,
    share: e.share,
  }));
  const regionEntry = Int32Array.from(assign, (j) => remap[j] ?? 0);
  return { entries, regionEntry, labelPoints: labelPoints(a.labels, a.width, a.height, a.regions.length) };
}

/** Oklab einer sRGB-Farbe (für Abstände in Tests und Anzeige) */
export const oklabOfSrgb = (c: readonly number[]): [number, number, number] =>
  oklabFromLinear(dec(c[0] ?? 0), dec(c[1] ?? 0), dec(c[2] ?? 0));
