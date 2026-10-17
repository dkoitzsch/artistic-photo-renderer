import { describe, expect, it } from 'vitest';
import { extractPalette } from '../../src/effects/palette';

function image(colors: [number, number, number][], each = 500): Uint8ClampedArray {
  const out = new Uint8ClampedArray(colors.length * each * 4);
  colors.forEach((c, k) => {
    for (let i = 0; i < each; i++) out.set([...c, 255], (k * each + i) * 4);
  });
  return out;
}

describe('Palette aus Bild (k-means in Oklab)', () => {
  it('findet die Farben eines Bildes und sortiert nach Helligkeit', () => {
    const pal = extractPalette(
      image([
        [255, 0, 0],
        [0, 0, 255],
        [250, 250, 250],
      ]),
      3,
    );
    const bytes = pal.map((c) => c.map((v) => Math.round(v * 255)));
    expect(bytes).toEqual([
      [0, 0, 255],
      [255, 0, 0],
      [250, 250, 250],
    ]);
  });

  it('deterministisch, ignoriert Transparenz, k größer als Farben', () => {
    const img = image([
      [10, 200, 30],
      [200, 100, 0],
    ]);
    expect(extractPalette(img, 2)).toEqual(extractPalette(img, 2));
    const transparent = new Uint8ClampedArray(400).fill(0);
    expect(extractPalette(transparent, 4)).toEqual([[0, 0, 0]]);
    expect(extractPalette(image([[100, 100, 100]], 3), 8).length).toBe(3);
  });
});
