import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, centered, fitView, pan, screenToImage, zoomAt } from '../../src/state/viewMath';

describe('zoomAt', () => {
  it('hält den Bildpunkt unter dem Cursor fest', () => {
    const view = { zoom: 0.5, offsetX: 40, offsetY: 30 };
    const before = screenToImage(view, 300, 200);
    const after = screenToImage(zoomAt(view, 300, 200, 2), 300, 200);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it('begrenzt den Zoom', () => {
    const view = { zoom: 1, offsetX: 0, offsetY: 0 };
    expect(zoomAt(view, 0, 0, 1e6).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0, 0, 0).zoom).toBe(MIN_ZOOM);
  });
});

describe('fitView / centered', () => {
  it('passt ein Querformat mit Rand ein und zentriert', () => {
    const v = fitView({ width: 4000, height: 2000 }, { width: 1064, height: 800 }, 32);
    expect(v.zoom).toBeCloseTo(0.25, 9);
    expect(v.offsetX).toBeCloseTo(32, 9);
    expect(v.offsetY).toBeCloseTo((800 - 500) / 2, 9);
  });

  it('zentriert bei 100 %', () => {
    const v = centered({ width: 100, height: 50 }, { width: 300, height: 150 }, 1);
    expect(v).toEqual({ zoom: 1, offsetX: 100, offsetY: 50 });
  });
});

describe('pan', () => {
  it('verschiebt nur den Versatz', () => {
    expect(pan({ zoom: 2, offsetX: 1, offsetY: 2 }, 10, -5)).toEqual({ zoom: 2, offsetX: 11, offsetY: -3 });
  });
});
