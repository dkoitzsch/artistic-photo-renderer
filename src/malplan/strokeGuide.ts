// Strichführung (Spec „Effekte“ 7.6): Pfeile für Strichrichtung, empfohlene Pinselbreite (mm auf dem Untergrund) und
// Reihenfolge. Mit `stroke-paint` im Projekt werden dessen Striche (gleiche Parameter und Seed) für den Malplan-Ausschnitt
// neu erzeugt; sonst Pfeile entlang des Richtungsfelds in einem Raster, Pinselbreite nach Flächengröße. Rein (Worker).

import { generateStrokes, type StrokeOptions } from '../../effects/stroke-paint/strokes';
import { flow as cpuFlow } from '../effects/cpuAnalysis';
import type { Analysis } from './analysis';

export type GuideStroke = {
  /** Pfad in Analyse-px */
  points: number[];
  /** Breite in Analyse-px */
  width: number;
  /** Gruppe: Pinselgröße 0 = größter */
  group: number;
};

export type StrokeGuide = {
  source: 'stroke-paint' | 'flow';
  strokes: GuideStroke[];
  /** Pinselbreite je Gruppe in Analyse-px */
  widths: number[];
};

const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** RGBA 8 Bit (sRGB) → RGBA float linear vormultipliziert (deckend) */
export function linearImage(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = dec((rgba[i * 4] ?? 0) / 255);
    out[i * 4 + 1] = dec((rgba[i * 4 + 1] ?? 0) / 255);
    out[i * 4 + 2] = dec((rgba[i * 4 + 2] ?? 0) / 255);
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Striche eines stroke-paint-Effekts für den Malplan-Ausschnitt (ohne zu malen: Leinwand nur zur Fehlerprüfung). */
export function guideFromStrokePaint(
  img: Float32Array,
  w: number,
  h: number,
  opts: StrokeOptions,
): StrokeGuide {
  const canvas = new Float32Array(w * h * 3).fill(0.8);
  // einfache Leinwand-Aktualisierung (gefüllte Kreise längs des Pfads), damit Folgeschichten wie im Effekt entstehen
  const paint = (s: { points: number[]; width: number; color: [number, number, number] }) => {
    const r = s.width / 2;
    for (let k = 0; k < s.points.length; k += 2) {
      const cx = s.points[k] ?? 0;
      const cy = s.points[k + 1] ?? 0;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const i = y * w + x;
          canvas[i * 3] = s.color[0];
          canvas[i * 3 + 1] = s.color[1];
          canvas[i * 3 + 2] = s.color[2];
        }
    }
  };
  const flow = opts.direction === 'flow' ? cpuFlow(img, w, h, opts.scale) : null;
  const strokes = generateStrokes(img, w, h, opts, flow, canvas, paint);
  const widths: number[] = [];
  for (const s of strokes) widths[s.layer] = s.width;
  return {
    source: 'stroke-paint',
    strokes: strokes.map((s) => ({ points: s.points, width: s.width, group: s.layer })),
    widths: Array.from({ length: widths.length }, (_, i) => widths[i] ?? 0),
  };
}

/**
 * Pfeile entlang des Richtungsfelds: Raster mit Abstand nach Flächengröße (große Flächen → breiter Pinsel). Drei
 * Pinselgruppen: groß (≥ 1,5 % der Bildfläche), mittel, klein (< 0,25 %).
 */
export function guideFromFlow(a: Analysis, img: Float32Array): StrokeGuide {
  const { width: w, height: h, labels, regions } = a;
  const flow = cpuFlow(img, w, h, 1);
  const total = regions.reduce((s, r) => s + r.area, 0) || 1;
  const long = Math.max(w, h);
  const widths = [long / 28, long / 60, long / 130];
  const groupOf = (r: number) => {
    const s = (regions[r]?.area ?? 0) / total;
    return s >= 0.015 ? 0 : s >= 0.0025 ? 1 : 2;
  };
  const strokes: GuideStroke[] = [];
  // Rasterabstand: etwa 36 Pfeile über die lange Kante – lesbar, ohne sich zu überdecken
  const step = long / 36;
  for (let y = step / 2; y < h; y += step)
    for (let x = step / 2; x < w; x += step) {
      const i = Math.floor(y) * w + Math.floor(x);
      const g = groupOf(labels[i] ?? 0);
      let tx = (flow[i * 4 + 1] ?? 0.5) * 2 - 1;
      let ty = (flow[i * 4 + 2] ?? 0.5) * 2 - 1;
      // Richtungsfeld ist vorzeichenlos: einheitlich nach rechts bzw. unten zeigen
      if (tx < -1e-6 || (Math.abs(tx) <= 1e-6 && ty < 0)) {
        tx = -tx;
        ty = -ty;
      }
      const l = Math.hypot(tx, ty);
      if (l < 1e-3) continue;
      const len = step * 0.36;
      strokes.push({
        points: [x - (tx / l) * len, y - (ty / l) * len, x + (tx / l) * len, y + (ty / l) * len],
        width: widths[g] ?? step,
        group: g,
      });
    }
  return { source: 'flow', strokes, widths };
}
