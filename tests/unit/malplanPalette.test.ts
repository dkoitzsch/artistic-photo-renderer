import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/malplan/analysis';
import { buildPalette, clusterRegions, labelPoints } from '../../src/malplan/palette';

/** Testbild: vier Farbflächen (Hautton, Himmelblau, Laubgrün, Braun) mit leichtem Rauschen */
function quads(w = 80, h = 60): Uint8ClampedArray {
  const cols = [
    [224, 172, 140],
    [122, 165, 214],
    [79, 107, 42],
    [107, 74, 51],
  ];
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = cols[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)] ?? [0, 0, 0];
      const i = (y * w + x) * 4;
      const n = ((x * 7 + y * 13) % 5) - 2;
      out[i] = (c[0] ?? 0) + n;
      out[i + 1] = (c[1] ?? 0) + n;
      out[i + 2] = (c[2] ?? 0) + n;
      out[i + 3] = 255;
    }
  return out;
}

describe('Reduzierte Palette', () => {
  const a = analyze(quads(), 80, 60, { shapes: 20, colors: 6 });

  it('fasst Flächenfarben flächengewichtet zusammen', () => {
    const { centers, assign } = clusterRegions(a, 4);
    expect(centers).toHaveLength(4);
    expect(assign).toHaveLength(a.regions.length);
    expect(new Set(assign).size).toBe(4);
  });

  it('Rezepte aus „Meine Farben“, nummeriert dunkel → hell, Mischfarbe nahe am Ziel', () => {
    const my = [
      'titanium-white',
      'ivory-black',
      'ultramarine',
      'cadmium-yellow-light',
      'yellow-ochre',
      'burnt-sienna',
      'cadmium-red-light',
      'phthalo-green',
      'alizarin-permanent',
      'phthalo-blue',
    ];
    const pal = buildPalette(a, 4, my);
    expect(pal.entries.map((e) => e.number)).toEqual([1, 2, 3, 4]);
    for (const e of pal.entries) {
      expect(e.deltaE).toBeLessThan(5);
      expect(e.recipe.every((p) => my.includes(p.id))).toBe(true);
    }
    expect(pal.entries.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1, 5);
    // hell → Nummer höher
    const lum = (c: readonly number[]) => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    expect(lum(pal.entries[3]?.mixed ?? [])).toBeGreaterThan(lum(pal.entries[0]?.mixed ?? []));
    expect(pal.regionEntry).toHaveLength(a.regions.length);
  });

  it('nur Weiß und Schwarz: Grautöne, Abweichung wird gemeldet', () => {
    const pal = buildPalette(a, 4, ['titanium-white', 'ivory-black']);
    expect(pal.entries.some((e) => e.deltaE > 5)).toBe(true);
    for (const e of pal.entries) expect(Math.max(...e.mixed) - Math.min(...e.mixed)).toBeLessThan(0.08);
  });

  it('Beschriftungspunkt liegt innen, mit größtem Randabstand', () => {
    const w = 20;
    const h = 10;
    const labels = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) labels[i] = i % w < 10 ? 0 : 1;
    const pts = labelPoints(labels, w, h, 2);
    expect(pts[0]).toBeGreaterThan(3);
    expect(pts[0]).toBeLessThan(7);
    expect(pts[3]).toBeGreaterThan(13);
    expect(pts[2]).toBeGreaterThan(3);
  });
});
