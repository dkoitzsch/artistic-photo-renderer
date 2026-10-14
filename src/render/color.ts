// Referenz-Implementierung der Farbraum-Formeln (IEC 61966-2-1).
// Die WGSL-Shader verwenden dieselben Formeln; die Unit-Tests sichern sie ab.

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Parst eine CSS-Hex-Farbe (#rgb oder #rrggbb) zu sRGB-kodierten Werten 0..1. */
export function parseHexColor(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.replace(/./g, '$&$&') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Ungültige Farbe: ${hex}`);
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
