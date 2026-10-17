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
});
