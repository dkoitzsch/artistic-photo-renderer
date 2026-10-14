// copyTextureToBuffer verlangt Zeilen mit einem Vielfachen von 256 Byte.
export const BYTES_PER_ROW_ALIGNMENT = 256;

export function paddedBytesPerRow(width: number, bytesPerPixel: number): number {
  const unpadded = width * bytesPerPixel;
  return Math.ceil(unpadded / BYTES_PER_ROW_ALIGNMENT) * BYTES_PER_ROW_ALIGNMENT;
}

/** Entfernt das Zeilen-Padding aus einem gelesenen Puffer. */
export function unpadRows(
  padded: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * bytesPerPixel;
  const stride = paddedBytesPerRow(width, bytesPerPixel);
  const out = new Uint8ClampedArray(rowBytes * height);
  for (let y = 0; y < height; y++) {
    out.set(padded.subarray(y * stride, y * stride + rowBytes), y * rowBytes);
  }
  return out;
}
