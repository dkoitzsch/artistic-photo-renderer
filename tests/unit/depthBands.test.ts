import { describe, expect, it } from 'vitest';
import {
  enforceGap,
  histogram,
  kmeansBoundaries,
  moveBoundary,
  presetValues,
  quantileBoundaries,
} from '../../src/ml/depthBands';

describe('Tiefenebenen', () => {
  it('Quantile teilen gleichmäßige Tiefe in gleich große Ebenen', () => {
    const d = Float32Array.from({ length: 10000 }, (_, i) => i / 10000);
    const b = quantileBoundaries(histogram(d), 4);
    expect(b).toHaveLength(5);
    expect(b[0]).toBe(0);
    expect(b[4]).toBe(1);
    expect(b[1]).toBeCloseTo(0.25, 2);
    expect(b[2]).toBeCloseTo(0.5, 2);
    expect(b[3]).toBeCloseTo(0.75, 2);
  });

  it('k-Means findet getrennte Tiefen-Cluster', () => {
    const d = new Float32Array(9000);
    for (let i = 0; i < 9000; i++) d[i] = ([0.1, 0.5, 0.9][i % 3] ?? 0) + ((i % 7) - 3) * 0.005;
    const b = kmeansBoundaries(histogram(d), 3);
    expect(b).toHaveLength(4);
    expect(b[1]).toBeGreaterThan(0.2);
    expect(b[1]).toBeLessThan(0.4);
    expect(b[2]).toBeGreaterThan(0.6);
    expect(b[2]).toBeLessThan(0.8);
  });

  it('Grenzen bleiben aufsteigend; Verschieben respektiert Nachbarn', () => {
    expect(enforceGap([0, 0.5, 0.5, 0.5, 1])).toEqual([0, 0.5, 0.51, 0.52, 1]);
    const b = [0, 0.3, 0.6, 1];
    expect(moveBoundary(b, 1, 0.9)).toEqual([0, 0.59, 0.6, 1]);
    expect(moveBoundary(b, 2, 0.1)).toEqual([0, 0.3, 0.31, 1]);
    expect(moveBoundary(b, 0, 0.5)).toBe(b);
  });

  it('Tiefen-Preset: nah scharf, fern unscharf und dunstig', () => {
    expect(presetValues('atmosphere', 0, 4, 40, 60)).toEqual({ blur: 0, haze: 0 });
    const far = presetValues('atmosphere', 3, 4, 40, 60);
    expect(far).toEqual({ blur: 40, haze: 60 });
    const mid = presetValues('atmosphere', 1, 4, 40, 60);
    expect(mid.blur).toBeGreaterThan(0);
    expect(mid.blur).toBeLessThan(far.blur);
    expect(presetValues('blur', 3, 4, 40, 60).haze).toBe(0);
    expect(presetValues('none', 3, 4, 40, 60)).toEqual({ blur: 0, haze: 0 });
  });
});
