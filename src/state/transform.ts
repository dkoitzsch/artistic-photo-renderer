// Platzierung einer Ebene auf der Leinwand (Spec f): Ebenen-px (Pixel des Originals) → Leinwand-px.
// Leinwand = Mitte + Versatz + Drehung · Spiegelung · Skalierung · (Ebenen-px − Mitte des Originals).
// Mit der Standard-Transformation liegt ein Original in Leinwandgröße deckungsgleich auf der Leinwand.

import type { Transform } from './project';

/** Affine Abbildung: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

export type Size = { width: number; height: number };

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0 };

export function isIdentity(t: Transform): boolean {
  return t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation % 360 === 0 && !t.flipX && !t.flipY;
}

/** Ebene deckt die Leinwand pixelgenau ab (schneller Pfad ohne Neuabtastung). */
export function isAligned(t: Transform, original: Size, canvas: Size): boolean {
  return isIdentity(t) && original.width === canvas.width && original.height === canvas.height;
}

/** Ebenen-px → Leinwand-px */
export function placement(t: Transform, original: Size, canvas: Size): Affine {
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = t.scale * (t.flipX ? -1 : 1);
  const sy = t.scale * (t.flipY ? -1 : 1);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const ox = original.width / 2;
  const oy = original.height / 2;
  return {
    a,
    b,
    c,
    d,
    e: canvas.width / 2 + t.x - (a * ox + c * oy),
    f: canvas.height / 2 + t.y - (b * ox + d * oy),
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** Ecken des Originals auf der Leinwand (oben links, oben rechts, unten rechts, unten links). */
export function corners(t: Transform, original: Size, canvas: Size): [number, number][] {
  const m = placement(t, original, canvas);
  const { width: w, height: h } = original;
  return [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
}

function rotatedExtent(rotation: number): { cos: number; sin: number } {
  const rad = (rotation * Math.PI) / 180;
  return { cos: Math.abs(Math.cos(rad)), sin: Math.abs(Math.sin(rad)) };
}

/** „Leinwand füllen“: kleinste Skalierung, bei der das (gedrehte) Bild die ganze Leinwand bedeckt; zentriert. */
export function fillTransform(t: Transform, original: Size, canvas: Size): Transform {
  const { cos, sin } = rotatedExtent(t.rotation);
  const scale = Math.max(
    (canvas.width * cos + canvas.height * sin) / original.width,
    (canvas.width * sin + canvas.height * cos) / original.height,
  );
  return { ...t, x: 0, y: 0, scale };
}

/** „Einpassen“: größte Skalierung, bei der das ganze (gedrehte) Bild sichtbar ist; zentriert. */
export function fitTransform(t: Transform, original: Size, canvas: Size): Transform {
  const { cos, sin } = rotatedExtent(t.rotation);
  const scale = Math.min(
    canvas.width / (original.width * cos + original.height * sin),
    canvas.height / (original.width * sin + original.height * cos),
  );
  return { ...t, x: 0, y: 0, scale };
}

/** Normiert einen Winkel auf (−180, 180]. */
export function normalizeAngle(deg: number): number {
  let r = deg % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}
