import { describe, expect, it } from 'vitest';
import { DAB_FLOATS, smoothPoint, strokesKey, strokesToDabs } from '../../src/brush/dabs';
import type { BrushStroke } from '../../src/state/project';

const stroke = (over: Partial<BrushStroke> = {}): BrushStroke => ({
  mode: 'add',
  size: 20,
  softness: 0.5,
  flow: 0.8,
  pressure: false,
  points: [0, 0, 1, 100, 0, 1],
  ...over,
});

describe('Pinsel-Tupfer', () => {
  it('gleichmäßiger Abstand entlang des Strichs, Radius = halbe Größe', () => {
    const d = strokesToDabs([stroke()], 1);
    const n = d.length / DAB_FLOATS;
    // Abstand 12 % des Durchmessers = 2,4 px → etwa 42 Tupfer auf 100 px
    expect(n).toBeGreaterThan(38);
    expect(n).toBeLessThan(46);
    expect(d[2]).toBeCloseTo(10);
    expect(d[3]).toBeCloseTo(0.8);
    expect(d[4]).toBeCloseTo(0.5); // Härte = 1 − Weichheit
    expect(d[5]).toBe(1);
    for (let i = 1; i < n; i++) {
      const dx = (d[i * DAB_FLOATS] ?? 0) - (d[(i - 1) * DAB_FLOATS] ?? 0);
      expect(dx).toBeCloseTo(2.4, 4);
    }
  });

  it('Maßstab und Druck: kleiner und schwächer bei wenig Druck, Entfernen hat Zielwert 0', () => {
    const d = strokesToDabs([stroke({ pressure: true, mode: 'remove', points: [10, 10, 0.2] })], 0.5);
    expect(d.length).toBe(DAB_FLOATS);
    expect(d[0]).toBe(5);
    expect(d[1]).toBe(5);
    // Radius 10 · 0,5 · (0,25 + 0,75 · 0,2) = 2
    expect(d[2]).toBeCloseTo(2);
    expect(d[3]).toBeCloseTo(0.8 * (0.35 + 0.65 * 0.2));
    expect(d[5]).toBe(0);
  });

  it('Abstand bleibt über Punktgrenzen gleich (viele kurze Abschnitte)', () => {
    const pts: number[] = [];
    for (let x = 0; x <= 100; x += 0.5) pts.push(x, 0, 1);
    const fine = strokesToDabs([stroke({ points: pts })], 1).length / DAB_FLOATS;
    const coarse = strokesToDabs([stroke()], 1).length / DAB_FLOATS;
    expect(Math.abs(fine - coarse)).toBeLessThanOrEqual(1);
  });

  it('Schlüssel ändert sich mit dem Inhalt, gleiche Liste gleicher Schlüssel', () => {
    const a = [stroke()];
    expect(strokesKey(a)).toBe(strokesKey(a));
    expect(strokesKey([stroke()])).toBe(strokesKey(a));
    expect(strokesKey([stroke({ size: 21 })])).not.toBe(strokesKey(a));
    expect(strokesKey([])).toBe('-');
  });

  it('Glättung folgt mit Verzögerung', () => {
    expect(smoothPoint(null, [5, 5], 1)).toEqual([5, 5]);
    expect(smoothPoint([0, 0], [10, 0], 0)).toEqual([10, 0]);
    const p = smoothPoint([0, 0], [10, 0], 1);
    expect(p[0]).toBeCloseTo(1);
  });
});
