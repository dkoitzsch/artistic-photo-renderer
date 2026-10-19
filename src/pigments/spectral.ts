// Spektrale Grundlagen der Pigment-Engine (Spec „Effekte“ 6): 31 Stützstellen 400–700 nm (10 nm), CIE-1931-2°-
// Normspektralwerte, Normlicht D65, Umrechnung Spektrum → XYZ → sRGB/CIELAB, Rekonstruktion glatter Reflexionsspektren
// aus sRGB (geringste Steigung des Logarithmus, beschränkt auf 0…1; Verfahren nach S. A. Burns, „Numerical methods for
// smoothest reflectance reconstruction“, 2020) und ΔE2000 (Sharma, Wu, Dalal 2005). Eigene Implementierung.

export const BANDS = 31;
export const WAVELENGTHS: readonly number[] = Array.from({ length: BANDS }, (_, i) => 400 + i * 10);

// CIE 1931 2° Normspektralwerte (10 nm, 400–700 nm)
const CMF_X = [
  0.01431, 0.04351, 0.13438, 0.2839, 0.34828, 0.3362, 0.2908, 0.19536, 0.09564, 0.03201, 0.0049, 0.0093,
  0.06327, 0.1655, 0.2904, 0.43345, 0.5945, 0.7621, 0.9163, 1.0263, 1.0622, 1.0026, 0.85445, 0.6424, 0.4479,
  0.2835, 0.1649, 0.0874, 0.04677, 0.0227, 0.011359,
];
const CMF_Y = [
  0.000396, 0.00121, 0.004, 0.0116, 0.023, 0.038, 0.06, 0.09098, 0.13902, 0.20802, 0.323, 0.503, 0.71, 0.862,
  0.954, 0.99495, 0.995, 0.952, 0.87, 0.757, 0.631, 0.503, 0.381, 0.265, 0.175, 0.107, 0.061, 0.032, 0.017,
  0.00821, 0.004102,
];
const CMF_Z = [
  0.06785, 0.2074, 0.6456, 1.3856, 1.74706, 1.77211, 1.6692, 1.28764, 0.81295, 0.46518, 0.272, 0.1582,
  0.07825, 0.04216, 0.0203, 0.00875, 0.0039, 0.0021, 0.00165, 0.0011, 0.0008, 0.00034, 0.00019, 0.00005,
  0.00002, 0, 0, 0, 0, 0, 0,
];
// Normlicht D65 (relative spektrale Strahlungsverteilung, 10 nm)
const D65 = [
  82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812, 114.861, 115.923, 108.811, 109.354, 107.802,
  104.79, 107.689, 104.405, 104.046, 100, 96.3342, 95.788, 88.6856, 90.0062, 89.5991, 87.6987, 83.6992,
  83.6997, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091,
];

/** XYZ eines Reflexionsspektrums unter D65 (Y der idealen Weißfläche = 1) */
const norm = CMF_Y.reduce((s, y, i) => s + y * (D65[i] ?? 0), 0);
const WX = CMF_X.map((x, i) => (x * (D65[i] ?? 0)) / norm);
const WY = CMF_Y.map((y, i) => (y * (D65[i] ?? 0)) / norm);
const WZ = CMF_Z.map((z, i) => (z * (D65[i] ?? 0)) / norm);
/** Weißpunkt des Spektralmodells (Summe der Gewichte) */
export const WHITE_XYZ: [number, number, number] = [sum(WX), sum(WY), sum(WZ)];

function sum(a: readonly number[]): number {
  return a.reduce((s, v) => s + v, 0);
}

// XYZ → lineares sRGB (D65)
const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

/**
 * Matrix Spektrum → lineares sRGB (3 × 31). Zeilen so skaliert, dass die ideale Weißfläche (R = 1) genau (1, 1, 1)
 * ergibt (gleicht die Kürzung auf 400–700 nm aus).
 */
export const SPEC_TO_RGB: number[][] = (() => {
  const rows = XYZ_TO_RGB.map((m) =>
    WX.map((x, i) => (m[0] ?? 0) * x + (m[1] ?? 0) * (WY[i] ?? 0) + (m[2] ?? 0) * (WZ[i] ?? 0)),
  );
  return rows.map((r) => {
    const s = sum(r);
    return r.map((v) => v / s);
  });
})();

export function spectrumToLinear(r: ArrayLike<number>): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const row = SPEC_TO_RGB[k] ?? [];
    let s = 0;
    for (let i = 0; i < BANDS; i++) s += (row[i] ?? 0) * (r[i] ?? 0);
    out[k] = s;
  }
  return out;
}

export const decodeSrgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const encodeSrgb = (l: number): number =>
  l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055;

export function hexToSrgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export function srgbToHex(c: readonly number[]): string {
  return `#${c
    .slice(0, 3)
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ---------- CIELAB und ΔE2000 ----------

/** lineares sRGB → XYZ (D65) */
export function linearToXyz([r, g, b]: readonly number[]): [number, number, number] {
  const R = r ?? 0;
  const G = g ?? 0;
  const B = b ?? 0;
  return [
    0.4124564 * R + 0.3575761 * G + 0.1804375 * B,
    0.2126729 * R + 0.7151522 * G + 0.072175 * B,
    0.0193339 * R + 0.119192 * G + 0.9503041 * B,
  ];
}

const D65_REF: [number, number, number] = [0.95047, 1, 1.08883];

export function xyzToLab([x, y, z]: readonly number[]): [number, number, number] {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((x ?? 0) / D65_REF[0]);
  const fy = f((y ?? 0) / D65_REF[1]);
  const fz = f((z ?? 0) / D65_REF[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const srgbToLab = (c: readonly number[]): [number, number, number] =>
  xyzToLab(linearToXyz(c.slice(0, 3).map(decodeSrgb)));

/** CIEDE2000-Farbabstand */
export function deltaE2000(a: readonly number[], b: readonly number[]): number {
  const [L1 = 0, a1 = 0, b1 = 0] = a;
  const [L2 = 0, a2 = 0, b2 = 0] = b;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (x: number, y: number) => {
    if (x === 0 && y === 0) return 0;
    const h = (Math.atan2(y, x) * 180) / Math.PI;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hpm = (h1p + h2p) / 2;
  }
  const rad = (d: number) => (d * Math.PI) / 180;
  const T =
    1 -
    0.17 * Math.cos(rad(hpm - 30)) +
    0.24 * Math.cos(rad(2 * hpm)) +
    0.32 * Math.cos(rad(3 * hpm + 6)) -
    0.2 * Math.cos(rad(4 * hpm - 63));
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// ---------- Rekonstruktion ----------

/** Löst A x = b (Gauß mit Spaltenpivot); A wird verändert. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]?.[c] ?? 0) > Math.abs(A[p]?.[c] ?? 0)) p = r;
    [A[c], A[p]] = [A[p] ?? [], A[c] ?? []];
    [b[c], b[p]] = [b[p] ?? 0, b[c] ?? 0];
    const piv = A[c]?.[c] ?? 0;
    if (Math.abs(piv) < 1e-14) continue;
    for (let r = c + 1; r < n; r++) {
      const f = (A[r]?.[c] ?? 0) / piv;
      if (f === 0) continue;
      const row = A[r] ?? [];
      const rc = A[c] ?? [];
      for (let k = c; k < n; k++) row[k] = (row[k] ?? 0) - f * (rc[k] ?? 0);
      b[r] = (b[r] ?? 0) - f * (b[c] ?? 0);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r] ?? 0;
    for (let k = r + 1; k < n; k++) s -= (A[r]?.[k] ?? 0) * (x[k] ?? 0);
    const d = A[r]?.[r] ?? 0;
    x[r] = Math.abs(d) < 1e-14 ? 0 : s / d;
  }
  return x;
}

/**
 * Glattes Reflexionsspektrum 0…1 zu einer sRGB-Farbe: minimiert die Krümmung (Summe der quadrierten Steigungen) einer
 * Hilfsgröße z mit R = (tanh z + 1) / 2 unter der Bedingung SPEC_TO_RGB · R = Farbe (Newton-Verfahren auf das
 * Lagrange-System). Ergebnis reproduziert die Farbe (bis auf Rundung), sofern sie nicht exakt 0 oder 1 enthält.
 */
export function reflectanceFromSrgb(srgb: readonly number[]): Float64Array {
  const target = srgb.slice(0, 3).map((c) => Math.min(0.999, Math.max(0.0005, decodeSrgb(c))));
  const n = BANDS;
  const z = new Array<number>(n).fill(0);
  const lam = [0, 0, 0];
  for (let it = 0; it < 40; it++) {
    const th = z.map(Math.tanh);
    const rho = th.map((t) => (t + 1) / 2);
    const d1 = th.map((t) => (1 - t * t) / 2); // dρ/dz
    const d2 = th.map((t) => -t * (1 - t * t)); // d²ρ/dz²
    // T^T λ
    const tl = Array.from({ length: n }, (_, i) =>
      [0, 1, 2].reduce((s, k) => s + (SPEC_TO_RGB[k]?.[i] ?? 0) * (lam[k] ?? 0), 0),
    );
    // Residuum
    const F: number[] = [];
    for (let i = 0; i < n; i++) {
      // 2 Dᵀ D z (Differenzen erster Ordnung)
      let dz = 0;
      if (i > 0) dz += (z[i] ?? 0) - (z[i - 1] ?? 0);
      if (i < n - 1) dz += (z[i] ?? 0) - (z[i + 1] ?? 0);
      F.push(2 * dz + (d1[i] ?? 0) * (tl[i] ?? 0));
    }
    let err = 0;
    for (let k = 0; k < 3; k++) {
      const row = SPEC_TO_RGB[k] ?? [];
      const c = row.reduce((s, v, i) => s + v * (rho[i] ?? 0), 0) - (target[k] ?? 0);
      F.push(c);
      err = Math.max(err, Math.abs(c));
    }
    if (err < 1e-9 && it > 2) break;
    // Jacobi-Matrix
    const J: number[][] = Array.from({ length: n + 3 }, () => new Array<number>(n + 3).fill(0));
    for (let i = 0; i < n; i++) {
      const row = J[i] ?? [];
      const deg = (i > 0 ? 1 : 0) + (i < n - 1 ? 1 : 0);
      row[i] = 2 * deg + (d2[i] ?? 0) * (tl[i] ?? 0);
      if (i > 0) row[i - 1] = -2;
      if (i < n - 1) row[i + 1] = -2;
      for (let k = 0; k < 3; k++) {
        const v = (SPEC_TO_RGB[k]?.[i] ?? 0) * (d1[i] ?? 0);
        row[n + k] = v;
        const rk = J[n + k] ?? [];
        rk[i] = v;
      }
    }
    const delta = solve(
      J,
      F.map((v) => -v),
    );
    for (let i = 0; i < n; i++) z[i] = Math.max(-12, Math.min(12, (z[i] ?? 0) + (delta[i] ?? 0)));
    for (let k = 0; k < 3; k++) lam[k] = (lam[k] ?? 0) + (delta[n + k] ?? 0);
  }
  return Float64Array.from(z, (v) => (Math.tanh(v) + 1) / 2);
}
