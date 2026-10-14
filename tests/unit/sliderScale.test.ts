import { describe, expect, it } from 'vitest';
import { positionToValue, quantize, valueToPosition } from '../../src/app/controls/scale';

describe('Regler-Skalen', () => {
  it('linear und logarithmisch sind umkehrbar', () => {
    for (const scale of ['linear', 'log'] as const) {
      for (const v of [0, 1, 7.5, 60, 299, 300]) {
        const t = valueToPosition(v, 0, 300, scale);
        expect(positionToValue(t, 0, 300, scale)).toBeCloseTo(v, 6);
      }
    }
  });

  it('log gibt kleinen Werten mehr Weg', () => {
    expect(valueToPosition(20, 0, 300, 'log')).toBeGreaterThan(0.5);
    expect(valueToPosition(20, 0, 300, 'linear')).toBeLessThan(0.1);
  });

  it('rastet auf Schritte ein und klemmt', () => {
    expect(quantize(12.345, 0.1, 0, 300)).toBe(12.3);
    expect(quantize(-4, 1, 0, 300)).toBe(0);
    expect(quantize(1000, 1, 0, 300)).toBe(300);
  });
});
