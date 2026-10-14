import { describe, expect, it } from 'vitest';
import { paddedBytesPerRow, unpadRows } from '../../src/render/readback';

describe('Zeilen-Padding', () => {
  it('rundet auf 256 Byte auf', () => {
    expect(paddedBytesPerRow(1, 4)).toBe(256);
    expect(paddedBytesPerRow(64, 4)).toBe(256);
    expect(paddedBytesPerRow(65, 4)).toBe(512);
  });

  it('entfernt das Padding zeilenweise', () => {
    const width = 3;
    const height = 2;
    const stride = paddedBytesPerRow(width, 4);
    const padded = new Uint8Array(stride * height).fill(99);
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < width * 4; i++) padded[y * stride + i] = y * 100 + i;
    }
    const out = unpadRows(padded, width, height, 4);
    expect(out.length).toBe(width * height * 4);
    expect(Array.from(out.subarray(0, 12))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(Array.from(out.subarray(12, 24))).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
    ]);
  });
});
