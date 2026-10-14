import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/io/hash';

describe('sha256Hex', () => {
  it('liefert den bekannten Hash von "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
