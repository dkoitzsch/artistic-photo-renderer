import { describe, expect, it } from 'vitest';
import { apply, fitCorners, rectToQuad, toMatrix3d } from '../../src/malplan/homography';

describe('Homographie (Beamer-Trapezkorrektur)', () => {
  it('bildet die Rechteckecken auf die Zielecken ab', () => {
    const q = [
      [10, 20],
      [300, 5],
      [280, 220],
      [30, 200],
    ] as const;
    const H = rectToQuad(400, 300, q);
    const src = [
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ] as const;
    src.forEach(([x, y], i) => {
      const [u, v] = apply(H, x, y);
      expect(u).toBeCloseTo(q[i]?.[0] ?? NaN, 6);
      expect(v).toBeCloseTo(q[i]?.[1] ?? NaN, 6);
    });
  });

  it('Rechteck auf Rechteck ist affin (keine Perspektive)', () => {
    const H = rectToQuad(100, 50, [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]);
    expect(H[6]).toBeCloseTo(0);
    expect(H[7]).toBeCloseTo(0);
    expect(apply(H, 50, 25)).toEqual([100, 50]);
    expect(toMatrix3d(H)).toMatch(/^matrix3d\(/);
  });

  it('eingepasste Ecken halten das Seitenverhältnis', () => {
    const c = fitCorners(2, 1000, 1000);
    expect(c[0]).toEqual([0, 0.25]);
    expect(c[2]).toEqual([1, 0.75]);
  });
});
