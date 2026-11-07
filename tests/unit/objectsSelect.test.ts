import { describe, expect, it } from 'vitest';
import { candidateFromLogits, selectObjects, type ObjectCandidate } from '../../src/ml/objectsSelect';

const W = 64;
const H = 64;

function rect(y0: number, y1: number, x0: number, x1: number, v = 4): Float32Array {
  const m = new Float32Array(W * H).fill(-v);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = v;
  return m;
}
const cand = (m: Float32Array, score: number): ObjectCandidate | null => candidateFromLogits(m, 0, W * H, score);
const nonNull = (xs: (ObjectCandidate | null)[]): ObjectCandidate[] => xs.filter((x): x is ObjectCandidate => !!x);

describe('Objekt-Auswahl (SAM-Kandidaten)', () => {
  it('große Objekte zuerst, kleine darüber, Duplikate und Winziges entfallen', () => {
    const cands = nonNull([
      cand(rect(8, 56, 8, 56), 0.95), // groß
      cand(rect(20, 36, 20, 36), 0.9), // klein, im großen
      cand(rect(9, 56, 8, 55), 0.93), // Duplikat des großen
      cand(rect(0, 3, 0, 3), 0.99), // zu klein
    ]);
    const { labels, objects } = selectObjects(cands, W, H, 8);
    expect(objects.map((o) => o.label)).toEqual([1, 2]);
    expect(labels[30 * W + 30]).toBe(2);
    expect(labels[10 * W + 10]).toBe(1);
    expect(labels[0]).toBe(0);
    expect(objects[0]?.area).toBeGreaterThan(objects[1]?.area ?? 1);
  });

  it('niedrige Güte oder instabile Ränder werden verworfen', () => {
    expect(cand(rect(10, 50, 10, 50), 0.2)).toBeNull();
    expect(cand(rect(10, 50, 10, 50, 0.5), 0.95)).toBeNull(); // Logits nahe 0
    expect(cand(rect(10, 50, 10, 50), 0.95)).not.toBeNull();
  });

  it('begrenzt die Zahl der Objekte', () => {
    const cands = nonNull([0, 1, 2, 3].map((i) => cand(rect(4 + 14 * i, 14 + 14 * i, 4, 60), 0.95)));
    expect(selectObjects(cands, W, H, 2).objects).toHaveLength(2);
  });

  it('ohne Kandidaten leere Karte', () => {
    const { labels, objects } = selectObjects([], W, H, 5);
    expect(objects).toEqual([]);
    expect(labels.every((v) => v === 0)).toBe(true);
  });
});
