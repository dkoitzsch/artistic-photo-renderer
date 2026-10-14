import { describe, expect, it } from 'vitest';
import { linearToSrgb, parseHexColor, srgbToLinear } from '../../src/render/color';

describe('sRGB <-> linear', () => {
  it('bildet die Endpunkte exakt ab', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it('kennt Referenzwerte', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 6);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.461356, 6);
  });

  it('ist für alle 8-Bit-Werte verlustfrei umkehrbar', () => {
    for (let v = 0; v <= 255; v++) {
      expect(Math.round(linearToSrgb(srgbToLinear(v / 255)) * 255)).toBe(v);
    }
  });

  it('ist monoton', () => {
    let prev = -1;
    for (let v = 0; v <= 1000; v++) {
      const l = srgbToLinear(v / 1000);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });
});

describe('parseHexColor', () => {
  it('parst lange und kurze Form', () => {
    expect(parseHexColor('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(parseHexColor(' #fff ')).toEqual([1, 1, 1]);
  });
  it('lehnt Ungültiges ab', () => {
    expect(() => parseHexColor('rgb(0,0,0)')).toThrow();
  });
});
