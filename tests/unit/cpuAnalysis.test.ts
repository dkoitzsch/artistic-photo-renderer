// Analysekarten auf der CPU (Worker-Effekte): gleiche Eigenschaften wie im Dienst (ml-service/tests/test_effects.py).
import { describe, expect, it } from 'vitest';
import { edges, flow } from '../../src/effects/cpuAnalysis';

function image(w: number, h: number, value: (x: number, y: number) => number): Float32Array {
  const img = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = value(x, y);
      const i = (y * w + x) * 4;
      img[i] = v;
      img[i + 1] = v;
      img[i + 2] = v;
      img[i + 3] = 1;
    }
  return img;
}

const tangent = (map: Float32Array, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [(map[i + 1] ?? 0) * 2 - 1, (map[i + 2] ?? 0) * 2 - 1] as const;
};

describe('cpuAnalysis', () => {
  it('Kanten: senkrechte Kante hat senkrechte Tangente', () => {
    const img = image(20, 20, (x) => (x >= 10 ? 1 : 0));
    const e = edges(img, 20, 20);
    const [, ty] = tangent(e, 20, 10, 10);
    expect(Math.abs(Math.abs(ty) - 1)).toBeLessThan(1e-3);
    expect(e[(10 * 20 + 2) * 4]).toBe(0);
  });

  it('Richtungsfeld folgt der Kante und setzt sich in der Fläche fort', () => {
    const w = 96;
    const f = flow(
      image(w, w, (x) => (x >= 48 ? 1 : 0)),
      w,
      w,
    );
    for (const x of [47, 30, 70]) {
      const [, ty] = tangent(f, w, x, 48);
      expect(Math.abs(Math.abs(ty) - 1)).toBeLessThan(1e-3);
      expect(f[(48 * w + x) * 4 + 3]).toBeGreaterThan(0.95);
    }
    for (const v of f) expect(Number.isFinite(v)).toBe(true);
  });

  it('Richtungsfeld: am Kreis tangential', () => {
    const w = 96;
    const f = flow(
      image(w, w, (x, y) => ((x - 48) ** 2 + (y - 48) ** 2 < 900 ? 1 : 0)),
      w,
      w,
    );
    for (const [x, y] of [
      [18, 48],
      [48, 18],
      [27, 27],
    ] as const) {
      const [tx, ty] = tangent(f, w, x, y);
      const rx = x - 48;
      const ry = y - 48;
      expect(Math.abs(tx * rx + ty * ry) / Math.hypot(rx, ry)).toBeLessThan(0.1);
    }
  });
});
