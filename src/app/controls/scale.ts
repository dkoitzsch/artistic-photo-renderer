// Abbildung Reglerposition (0..1) ↔ Wert, linear oder logarithmisch.

export type SliderScale = 'linear' | 'log';

function logK(min: number, max: number): number {
  return Math.log2(1 + (max - min));
}

export function valueToPosition(v: number, min: number, max: number, scale: SliderScale): number {
  const c = Math.min(max, Math.max(min, v));
  if (scale === 'log') {
    const L = logK(min, max);
    return Math.log2(1 + (c - min)) / L;
  }
  return (c - min) / (max - min);
}

export function positionToValue(t: number, min: number, max: number, scale: SliderScale): number {
  const u = Math.min(1, Math.max(0, t));
  if (scale === 'log') {
    const L = logK(min, max);
    return min + (2 ** (u * L) - 1);
  }
  return min + u * (max - min);
}

/** Rundet auf das Raster des Reglers. */
export function quantize(v: number, step: number, min: number, max: number): number {
  const q = Math.round((v - min) / step) * step + min;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Math.min(max, Math.max(min, Number(q.toFixed(decimals))));
}

export function formatValue(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toFixed(Math.min(decimals, 2));
}
