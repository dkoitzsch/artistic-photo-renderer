import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../src/malplan/analysis';
import { blurL, classify, measureEdges } from '../../src/malplan/edges';

/**
 * Drei Streifen 60 px breit: A (L 0,2) | B (L 0,8) mit hartem Sprung, B | C (L 0,3) mit weichem Verlauf über 16 px,
 * dazu ein vierter Streifen D (L 0,32) neben C mit kaum Kontrast.
 */
function scene(): { a: Analysis; L: Float32Array } {
  const w = 240;
  const h = 20;
  const labels = new Int32Array(w * h);
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = x < 60 ? 0 : x < 120 ? 1 : x < 180 ? 2 : 3;
      labels[i] = r;
      let l = [0.2, 0.8, 0.3, 0.32][r] ?? 0;
      // weicher Übergang B → C zwischen x = 112 und 128
      if (x >= 112 && x < 128) l = 0.8 + ((x - 112) / 16) * (0.3 - 0.8);
      L[i] = l;
    }
  const reg = (l: number) => ({
    lab: [l, 0, 0] as [number, number, number],
    rgb: [l, l, l] as [number, number, number],
    area: 1200,
  });
  return {
    a: { width: w, height: h, labels, regions: [reg(0.2), reg(0.8), reg(0.3), reg(0.32)] },
    L: blurL(L, w, h),
  };
}

describe('Kanten-Karte', () => {
  it('hart, weich, verloren', () => {
    const { a, L } = scene();
    const m = measureEdges(a, L);
    const cls = classify(m, 0.04, 3.5);
    const at = (x: number) => cls[10 * a.width + x];
    expect(at(59)).toBe(1); // harter Sprung A|B
    expect(at(119)).toBe(2); // weicher Verlauf B|C
    expect(at(179)).toBe(3); // kaum Kontrast C|D
    expect(at(30)).toBe(0); // im Inneren keine Kante
    // Breite: hart schmal, weich breit
    expect(m.width[10 * a.width + 59]).toBeLessThan(3.5);
    expect(m.width[10 * a.width + 119]).toBeGreaterThan(8);
  });

  it('Schwellen verschieben die Einteilung', () => {
    const { a, L } = scene();
    const m = measureEdges(a, L);
    expect(classify(m, 0.04, 40)[10 * a.width + 119]).toBe(1); // sehr großzügig: alles hart
    expect(classify(m, 0.7, 3.5)[10 * a.width + 59]).toBe(3); // hohe Verlust-Schwelle: Sprung gilt als verloren
  });
});
