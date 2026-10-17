import { describe, expect, it } from 'vitest';
import { mulberry32, randCell } from '../../src/effects/random';

describe('Zufall (Seed)', () => {
  it('randCell ist deterministisch, gleichverteilt und hängt vom Seed ab', () => {
    expect(randCell(10, -3, 42)).toBe(randCell(10, -3, 42));
    expect(randCell(10, -3, 42)).not.toBe(randCell(10, -3, 43));
    expect(randCell(10, -3, 42, 0)).not.toBe(randCell(10, -3, 42, 1));
    let sum = 0;
    let min = 1;
    let max = 0;
    const n = 200 * 200;
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const v = randCell(x, y, 7);
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    expect(sum / n).toBeCloseTo(0.5, 2);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('mulberry32 wiederholt sich bei gleichem Seed', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(mulberry32(6)()).not.toBe(xs[0]);
  });

  it('Referenzwerte (gleich in Shader, Browser-CPU und Python-Dienst: ml-service/tests/test_effects.py)', () => {
    expect(randCell(10, -3, 42, 0)).toBe(0.547438383102417);
    expect(randCell(0, 0, 7, 0)).toBe(0.9950028657913208);
    expect(randCell(123, 456, 1, 2)).toBe(0.21902084350585938);
    expect(randCell(-5, 9, 4000000000, 1)).toBe(0.2546077370643616);
  });
});
