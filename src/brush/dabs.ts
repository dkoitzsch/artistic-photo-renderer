// Pinselstriche → Tupfer (Basis-Spec g): gleichmäßig entlang des Strichs, Größe und Deckkraft nach Stiftdruck.
// Rein und getestet; die GPU zeichnet die Tupfer in Malreihenfolge (render/shaders/paint.wgsl).

import type { BrushStroke } from '../state/project';

/** Werte je Tupfer im Puffer: x, y (Ziel-px), Radius (px), Deckkraft, Härte (0..1), Zielwert (0 oder 1) */
export const DAB_FLOATS = 6;

/** Abstand zwischen Tupfern relativ zum Durchmesser (klein genug für glatte Striche) */
const SPACING = 0.12;

/** Radius und Deckkraft eines Tupfers aus Strich und Druck. */
function dabOf(s: BrushStroke, p: number, scale: number): [number, number] {
  const pr = s.pressure ? Math.min(1, Math.max(0, p)) : 1;
  const radius = Math.max(0.5, (s.size / 2) * scale * (s.pressure ? 0.25 + 0.75 * pr : 1));
  const alpha = Math.min(1, Math.max(0, s.flow * (s.pressure ? 0.35 + 0.65 * pr : 1)));
  return [radius, alpha];
}

/**
 * Tupfer aller Striche (Reihenfolge = Malreihenfolge). scale: Ziel-px je Ebenen-px.
 * Ein Strich mit einem Punkt ergibt einen Tupfer.
 */
export function strokesToDabs(strokes: readonly BrushStroke[], scale: number): Float32Array {
  const out: number[] = [];
  for (const s of strokes) {
    const pts = s.points;
    const n = Math.floor(pts.length / 3);
    if (n === 0) continue;
    const hardness = 1 - Math.min(1, Math.max(0, s.softness));
    const target = s.mode === 'add' ? 1 : 0;
    const push = (x: number, y: number, p: number) => {
      const [r, a] = dabOf(s, p, scale);
      out.push(x * scale, y * scale, r, a, hardness, target);
    };
    let x0 = pts[0] ?? 0;
    let y0 = pts[1] ?? 0;
    let p0 = pts[2] ?? 1;
    push(x0, y0, p0);
    // zurückgelegter Weg seit dem letzten Tupfer (Ebenen-px), damit der Abstand über Punktgrenzen gleich bleibt
    let since = 0;
    for (let i = 1; i < n; i++) {
      const x1 = pts[i * 3] ?? 0;
      const y1 = pts[i * 3 + 1] ?? 0;
      const p1 = pts[i * 3 + 2] ?? 1;
      const len = Math.hypot(x1 - x0, y1 - y0);
      let pos = 0;
      for (;;) {
        const pMid = p0 + (p1 - p0) * (len > 0 ? Math.min(1, pos / len) : 0);
        const step = Math.max(0.25 / scale, dabOf(s, pMid, 1)[0] * 2 * SPACING);
        const need = step - since;
        if (pos + need > len) break;
        pos += need;
        since = 0;
        const k = len > 0 ? pos / len : 0;
        push(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, p0 + (p1 - p0) * k);
      }
      since += len - pos;
      x0 = x1;
      y0 = y1;
      p0 = p1;
    }
  }
  return new Float32Array(out);
}

/**
 * Glättung beim Malen (Basis-Spec g, „Glättung 0–100 %“): gleitender Mittelpunkt, der der Maus mit Verzögerung folgt.
 * amount 0 = keine Glättung, 1 = stark.
 */
export function smoothPoint(
  prev: [number, number] | null,
  next: [number, number],
  amount: number,
): [number, number] {
  if (!prev) return next;
  const k = 1 - 0.9 * Math.min(1, Math.max(0, amount));
  return [prev[0] + (next[0] - prev[0]) * k, prev[1] + (next[1] - prev[1]) * k];
}

/** Kurzer, stabiler Schlüssel einer Strichliste (FNV-1a über die Zahlen) für Caches. */
const keys = new WeakMap<readonly BrushStroke[], string>();
export function strokesKey(strokes: readonly BrushStroke[] | undefined): string {
  if (!strokes || strokes.length === 0) return '-';
  const hit = keys.get(strokes);
  if (hit) return hit;
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    // Zahl auf 1/64 px runden und einmischen
    let x = Math.round(v * 64) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  };
  for (const s of strokes) {
    mix(s.mode === 'add' ? 1 : 2);
    mix(s.size);
    mix(s.softness);
    mix(s.flow);
    mix(s.pressure ? 1 : 0);
    mix(s.points.length);
    for (const v of s.points) mix(v);
  }
  const key = `${strokes.length}:${(h >>> 0).toString(36)}`;
  keys.set(strokes, key);
  return key;
}
