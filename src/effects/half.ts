// Umwandlung IEEE-754-Halbgenauigkeit (float16, Arbeitsformat rgba16float) ↔ float32 – für Readback, Worker und Dienst.

let toFloatTable: Float32Array | null = null;

function table(): Float32Array {
  if (toFloatTable) return toFloatTable;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    const s = h & 0x8000 ? -1 : 1;
    t[h] =
      e === 0
        ? s * 2 ** -14 * (m / 1024)
        : e === 31
          ? m
            ? NaN
            : s * Infinity
          : s * 2 ** (e - 15) * (1 + m / 1024);
  }
  toFloatTable = t;
  return t;
}

export function halfToFloat32(src: Uint16Array): Float32Array {
  const t = table();
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = t[src[i] ?? 0] ?? 0;
  return out;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float32 → float16 mit Rundung zum nächsten Wert (wie die GPU beim Schreiben). */
export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0] ?? 0;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf/NaN
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00; // Überlauf → Inf
  if (e <= 0) {
    if (e < -10) return sign; // zu klein → 0
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  // Rundung kann in den Exponenten überlaufen – das ergibt korrekt den nächsten Wert bzw. Inf
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++;
  return sign | h;
}

export function float32ToHalf(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = floatToHalf(src[i] ?? 0);
  return out;
}
