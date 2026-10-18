// Malplan: Formate, Zuschnitt, Raster und die Flächenanalyse (Werte, Notan, Wärme, Konturen).
import { describe, expect, it } from 'vitest';
import {
  analyze,
  chaikin,
  components,
  contours,
  douglasPeucker,
  levelMap,
  medianLightness,
  notanOfRegions,
  oklabFromLinear,
  valueLevels,
  warmth,
} from '../../src/malplan/analysis';
import {
  adaptCrop,
  defaultMalplan,
  fitCrop,
  gridLines,
  normalizeMalplan,
  orientFormat,
} from '../../src/malplan/model';

/** Bild aus Farbflächen: links dunkelblau, Mitte orange, rechts weiß, mit Rauschen. */
function testImage(w: number, h: number, noise = 0): Uint8ClampedArray {
  const img = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5) * noise;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = x < w / 3 ? [20, 40, 120] : x < (2 * w) / 3 ? [230, 140, 40] : [245, 245, 240];
      img[i] = (c[0] ?? 0) + rnd();
      img[i + 1] = (c[1] ?? 0) + rnd();
      img[i + 2] = (c[2] ?? 0) + rnd();
      img[i + 3] = 255;
    }
  return img;
}

describe('Malplan-Modell', () => {
  it('Zuschnitt passt das Seitenverhältnis an und bleibt im Bild', () => {
    const canvas = { width: 3000, height: 2000 };
    const c = fitCrop(canvas, 1); // quadratisch
    expect(c.height).toBeCloseTo(1);
    expect(c.width).toBeCloseTo(2 / 3);
    expect(c.x).toBeCloseTo(1 / 6);
    const wide = fitCrop(canvas, 2);
    expect(wide.width).toBeCloseTo(1);
    expect(wide.height).toBeCloseTo(0.75);
    const adapted = adaptCrop({ x: 0.7, y: 0, width: 0.3, height: 0.45 }, canvas, 1);
    // Seitenverhältnis in Leinwand-px = 1
    expect((adapted.width * 3000) / (adapted.height * 2000)).toBeCloseTo(1);
    expect(adapted.x + adapted.width).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('Format folgt der Ausrichtung, Raster in cm', () => {
    expect(orientFormat(30, 40, true)).toEqual([40, 30]);
    expect(orientFormat(40, 30, false)).toEqual([30, 40]);
    const s = defaultMalplan({ width: 2000, height: 3000 });
    expect(s.format.widthCm).toBeLessThan(s.format.heightCm);
    expect(gridLines(s)).toEqual({ xs: [7.5, 15, 22.5], ys: [10, 20, 30] });
    const sp = { ...s, grid: { ...s.grid, mode: 'spacing' as const, spacingCm: 10 } };
    expect(gridLines(sp)).toEqual({ xs: [10, 20], ys: [10, 20, 30] });
  });

  it('normalizeMalplan ergänzt und begrenzt Werte', () => {
    const n = normalizeMalplan(
      { shapes: 99999, colors: 2, values: { levels: 7 } },
      { width: 10, height: 10 },
    );
    expect(n.shapes).toBe(2000);
    expect(n.colors).toBe(4);
    expect(n.values.levels).toBe(4);
    expect(normalizeMalplan(null, { width: 10, height: 10 }).technique).toBe('acrylic');
  });
});

describe('Malplan-Analyse', () => {
  it('Flächen: drei Farbflächen mit Rauschen ergeben drei Flächen', () => {
    const w = 90;
    const h = 40;
    const a = analyze(testImage(w, h, 30), w, h, { shapes: 3, colors: 6 });
    expect(a.regions.length).toBe(3);
    // links dunkel, rechts hell
    const left = a.regions[a.labels[20 * w + 5] ?? 0];
    const right = a.regions[a.labels[20 * w + 85] ?? 0];
    expect(left?.lab[0]).toBeLessThan(right?.lab[0] ?? 0);
    expect(a.regions.reduce((s, r) => s + r.area, 0)).toBe(w * h);
  });

  it('Formen-Regler: mehr Formen → mehr Flächen', () => {
    const w = 120;
    const h = 80;
    const img = testImage(w, h, 80);
    const few = analyze(img, w, h, { shapes: 3, colors: 8 });
    const many = analyze(img, w, h, { shapes: 40, colors: 8 });
    expect(many.regions.length).toBeGreaterThan(few.regions.length);
    expect(many.regions.length).toBeLessThanOrEqual(40);
  });

  it('Tonwerte, Notan, Inselbereinigung', () => {
    const w = 90;
    const h = 40;
    const a = analyze(testImage(w, h), w, h, { shapes: 3, colors: 3 });
    const { level, tones } = valueLevels(a, 3);
    expect(tones[0]).toBeLessThan(tones[2] ?? 0);
    const map = levelMap(a, level, 1);
    expect(map[20 * w + 5]).toBe(0);
    expect(map[20 * w + 85]).toBe(2);
    const notan = levelMap(a, notanOfRegions(a, medianLightness(a)), 1);
    expect(notan[20 * w + 5]).toBe(0);
    expect(notan[20 * w + 85]).toBe(1);
    // Insel kleiner als die Mindestfläche verschwindet
    const lv = Uint8Array.from(a.regions, () => 0);
    const island = { ...a, labels: a.labels.slice() };
    const extra = a.regions.length;
    island.regions = [...a.regions, { lab: [1, 0, 0], rgb: [1, 1, 1], area: 4 }];
    for (const p of [5 * w + 5, 5 * w + 6, 6 * w + 5, 6 * w + 6]) island.labels[p] = extra;
    const lv2 = Uint8Array.from([...lv, 1]);
    expect(levelMap(island, lv2, 1)[5 * w + 5]).toBe(1);
    expect(levelMap(island, lv2, 10)[5 * w + 5]).toBe(0);
  });

  it('Wärme unabhängig von der Helligkeit', () => {
    const orange = oklabFromLinear(0.9, 0.3, 0.02);
    const blue = oklabFromLinear(0.02, 0.1, 0.8);
    expect(warmth(orange)).toBeGreaterThan(0.5);
    expect(warmth(blue)).toBeLessThan(-0.3);
    expect(Math.abs(warmth(oklabFromLinear(0.2, 0.2, 0.2)))).toBeLessThan(0.01);
    expect(Math.abs(warmth(oklabFromLinear(0.9, 0.9, 0.9)))).toBeLessThan(0.01);
  });

  it('Konturen: Grenzen zwischen Flächen, kein Bildrand', () => {
    const w = 30;
    const h = 20;
    const labels = new Int32Array(w * h).map((_, p) => (p % w < 15 ? 0 : 1));
    const lines = contours(labels, w, h);
    expect(lines.length).toBe(1);
    const l = lines[0] ?? new Float32Array();
    // senkrechte Linie bei x = 15/30 über die ganze Höhe
    for (let i = 0; i < l.length; i += 2) expect(l[i]).toBeCloseTo(0.5, 5);
    expect(Math.min(...Array.from(l).filter((_, i) => i % 2 === 1))).toBeCloseTo(0);
    expect(Math.max(...Array.from(l).filter((_, i) => i % 2 === 1))).toBeCloseTo(1);
    // Kreis ergibt einen geschlossenen Ring
    const ring = new Int32Array(w * h).map((_, p) =>
      ((p % w) - 15) ** 2 + (Math.floor(p / w) - 10) ** 2 < 25 ? 1 : 0,
    );
    const rl = contours(ring, w, h);
    expect(rl.length).toBe(1);
    const r = rl[0] ?? new Float32Array();
    expect(r[0]).toBeCloseTo(r[r.length - 2] ?? -1, 5);
  });

  it('Douglas-Peucker und Chaikin', () => {
    expect(douglasPeucker([0, 0, 1, 0.01, 2, 0, 3, 0], 0.1)).toEqual([0, 0, 3, 0]);
    const c = chaikin([0, 0, 1, 0, 1, 1], 1, false);
    expect(c.slice(0, 2)).toEqual([0, 0]);
    expect(c.slice(-2)).toEqual([1, 1]);
    expect(components([1, 1, 2, 2, 1, 1], 3, 2).count).toBe(3);
  });
});

describe('Kachelung der Konturvorlage', () => {
  it('wählt die Ausrichtung mit den wenigsten Blättern, Passmarken in der Überlappung', async () => {
    const { tileLayout, tileOrigin, tileName } = await import('../../src/malplan/tiles');
    // 60 × 80 cm auf A4 (bedruckbar 19 × 27,7 cm), 1 cm Überlappung
    const t = tileLayout(60, 80, 'A4', 1);
    expect(t.cols * t.rows).toBeLessThanOrEqual(16);
    // jede Stelle des Formats liegt auf einem Blatt
    for (let r = 0; r < t.rows; r++)
      for (let c = 0; c < t.cols; c++) {
        const [x, y] = tileOrigin(t, r, c);
        expect(x).toBeLessThan(60);
        expect(y).toBeLessThan(80);
      }
    const [lx, ly] = tileOrigin(t, t.rows - 1, t.cols - 1);
    expect(lx + t.printable[0]).toBeGreaterThanOrEqual(60);
    expect(ly + t.printable[1]).toBeGreaterThanOrEqual(80);
    // Passmarke zwischen Spalte 0 und 1 liegt in beiden Blättern
    const m = t.marksX[0] ?? 0;
    expect(m).toBeGreaterThan(t.step[0]);
    expect(m).toBeLessThan(t.printable[0]);
    expect(tileName(1, 2)).toBe('C2');
    // kleines Format: ein Blatt
    const one = tileLayout(18, 24, 'A4', 1);
    expect(one.cols * one.rows).toBe(1);
    expect(one.marksX).toEqual([]);
  });
});
