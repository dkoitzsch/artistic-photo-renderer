// 16-Bit-Graustufen-PNG für Masken (Browser-Canvas kann nur 8 Bit).

import { decode, encode } from 'fast-png';

export type MaskData = { width: number; height: number; data: Uint16Array };

export function encodeMaskPng(mask: MaskData): Uint8Array<ArrayBuffer> {
  return encode({
    width: mask.width,
    height: mask.height,
    data: mask.data,
    depth: 16,
    channels: 1,
  }) as Uint8Array<ArrayBuffer>;
}

export function decodeMaskPng(bytes: Uint8Array): MaskData {
  const img = decode(bytes);
  const { width, height, channels, depth } = img;
  const n = width * height;
  const out = new Uint16Array(n);
  const src = img.data;
  const scale = depth === 16 ? 1 : 257;
  for (let i = 0; i < n; i++) out[i] = (src[i * channels] ?? 0) * scale;
  return { width, height, data: out };
}

/** Float 0…1 → 16 Bit */
export function floatToMask(data: Float32Array, width: number, height: number): MaskData {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, data[i] ?? 0)) * 65535);
  return { width, height, data: out };
}
