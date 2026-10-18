// Trapezkorrektur des Beamer-Modus: projektive Abbildung (Homographie) eines Rechtecks auf vier frei gezogene Ecken,
// als CSS-matrix3d. Reine Mathematik, getestet in tests/unit/homography.test.ts.

export type Pt = readonly [number, number];

/**
 * Homographie H (3 × 3, zeilenweise, h22 = 1), die das Rechteck (0,0)-(w,h) auf die Ecken q0..q3
 * (oben links, oben rechts, unten rechts, unten links) abbildet.
 */
export function rectToQuad(w: number, h: number, q: readonly [Pt, Pt, Pt, Pt]): number[] {
  // Einheitsquadrat → Viereck (Heckbert 1989), danach Skalierung des Rechtecks auf das Einheitsquadrat
  const [p0, p1, p2, p3] = q;
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let hh = 0;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / det;
    hh = (dx1 * sy - sx * dy1) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  const f = y0;
  // u = x / w, v = y / h
  return [a / w, b / h, c, d / w, e / h, f, g / w, hh / h, 1];
}

/** Wendet H auf einen Punkt an. */
export function apply(H: readonly number[], x: number, y: number): [number, number] {
  const den = (H[6] ?? 0) * x + (H[7] ?? 0) * y + (H[8] ?? 1);
  return [
    ((H[0] ?? 0) * x + (H[1] ?? 0) * y + (H[2] ?? 0)) / den,
    ((H[3] ?? 0) * x + (H[4] ?? 0) * y + (H[5] ?? 0)) / den,
  ];
}

/** CSS matrix3d (spaltenweise) zu H; das Element liegt bei (0,0) mit transform-origin 0 0. */
export function toMatrix3d(H: readonly number[]): string {
  const m = [H[0], H[3], 0, H[6], H[1], H[4], 0, H[7], 0, 0, 1, 0, H[2], H[5], 0, H[8]];
  return `matrix3d(${m.map((v) => (v ?? 0).toPrecision(10)).join(',')})`;
}

/** Ecken für ein eingepasstes Bild (Seitenverhältnis aspect) in einem Bereich vw × vh, normiert auf 0..1. */
export function fitCorners(
  aspect: number,
  vw: number,
  vh: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  let w = vw;
  let h = vw / aspect;
  if (h > vh) {
    h = vh;
    w = vh * aspect;
  }
  const x0 = (vw - w) / 2 / vw;
  const y0 = (vh - h) / 2 / vh;
  const x1 = x0 + w / vw;
  const y1 = y0 + h / vh;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}
