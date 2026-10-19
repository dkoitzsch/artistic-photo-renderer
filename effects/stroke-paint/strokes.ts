// Strich-basiertes Malen nach Hertzmann (1998, „Painterly Rendering with Curved Brush Strokes of Multiple Sizes“):
// von großen zu kleinen Pinseln; je Pinsel ein Referenzbild (geglättet mit Radius ∝ Pinselgröße), Raster mit
// Zellgröße = Pinselgröße, wo die gemalte Leinwand zu stark abweicht, beginnt ein Strich am Punkt der größten
// Abweichung und folgt dem Richtungsfeld (oder quer zum Gradienten), bis die Farbe nicht mehr passt.
// Jeder Strich ist ein Datenobjekt (Pfad, Breite, Farbe, Schicht, Reihenfolge) – der Malplan nutzt dieselben Daten
// für die Strichführung. Rein (Worker, Malplan-Worker, Tests); Koordinaten in Leinwand-px (Vorschau = Export).

import { mulberry32 } from '../../src/effects/random';

export type Stroke = {
  /** Pfad in Render-px des Bildes: x0, y0, x1, y1, … */
  points: number[];
  /** Breite in Render-px */
  width: number;
  /** Farbe linear (nicht vormultipliziert) */
  color: [number, number, number];
  /** Schicht (0 = größter Pinsel) */
  layer: number;
  /** Reihenfolge des Auftrags */
  order: number;
};

export type StrokeOptions = {
  /** größte Pinselbreite in Leinwand-px */
  brushSize: number;
  /** Anzahl Pinselgrößen (jeweils halbiert) */
  levels: number;
  /** Detail 0…1: kleiner = größere Abweichung erlaubt */
  detail: number;
  /** größte Strichlänge in Pinselbreiten */
  length: number;
  /** Krümmung 0…1 (0 = ganz träge, 1 = folgt dem Feld sofort) */
  curvature: number;
  /** Richtung: 'flow' = Richtungsfeld, 'gradient' = quer zum Helligkeitsgradienten des Referenzbildes */
  direction: 'flow' | 'gradient';
  /** Farbstreuung je Strich 0…1 */
  jitter: number;
  seed: number;
  /** Render-px je Leinwand-px */
  scale: number;
  /** Lage des Bildes auf der Leinwand (Render-px) */
  origin: readonly [number, number];
};

type Rgb = Float32Array; // w·h·3, linear

/** Kastenunschärfe (drei Durchgänge ≈ Gauß) je Kanal */
function boxBlur(src: Rgb, w: number, h: number, radius: number): Rgb {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return src.slice();
  const a = src.slice();
  const b = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const n = horizontal ? w : h;
    const m = horizontal ? h : w;
    for (let j = 0; j < m; j++)
      for (let c = 0; c < 3; c++) {
        const idx = (i: number) => {
          const k = Math.min(n - 1, Math.max(0, i));
          return (horizontal ? j * w + k : k * w + j) * 3 + c;
        };
        let s = 0;
        for (let i = -r; i <= r; i++) s += from[idx(i)] ?? 0;
        for (let i = 0; i < n; i++) {
          to[idx(i)] = s / (2 * r + 1);
          s += (from[idx(i + r + 1)] ?? 0) - (from[idx(i - r)] ?? 0);
        }
      }
  };
  for (let k = 0; k < 3; k++) {
    pass(a, b, true);
    pass(b, a, false);
  }
  return a;
}

const lumOf = (c: Rgb, i: number) =>
  0.2126 * (c[i * 3] ?? 0) + 0.7152 * (c[i * 3 + 1] ?? 0) + 0.0722 * (c[i * 3 + 2] ?? 0);

/** Wahrnehmungsnaher Farbabstand (sRGB-kodiert, euklidisch) zweier linearer Farben */
function dist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const e = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  return Math.hypot(e(r1) - e(r2), e(g1) - e(g2), e(b1) - e(b2));
}

/**
 * Erzeugt die Striche. img: RGBA linear vormultipliziert (w·h·4); flow: Richtungsfeld (w·h·4, gb = Tangente als
 * 0.5 + 0.5·t) oder null. paint: Rückruf, der einen Strich sofort auf die Leinwand malt (für die Fehlerprüfung der
 * nächsten Schicht); canvas: die Leinwand (w·h·3 linear), die paint verändert.
 */
export function generateStrokes(
  img: Float32Array,
  w: number,
  h: number,
  opts: StrokeOptions,
  flow: Float32Array | null,
  canvas: Rgb,
  paint: (s: Stroke) => void,
  progress: (p: number) => void = () => undefined,
): Stroke[] {
  const n = w * h;
  const rgb: Rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = img[i * 4 + 3] ?? 0;
    const d = a > 0 ? a : 1;
    rgb[i * 3] = (img[i * 4] ?? 0) / d;
    rgb[i * 3 + 1] = (img[i * 4 + 1] ?? 0) / d;
    rgb[i * 3 + 2] = (img[i * 4 + 2] ?? 0) / d;
  }
  const strokes: Stroke[] = [];
  const rand = mulberry32(opts.seed >>> 0 || 1);
  const threshold = 0.02 + (1 - opts.detail) * 0.25;
  const levels = Math.max(1, Math.round(opts.levels));
  const [ox, oy] = opts.origin;
  for (let layer = 0; layer < levels; layer++) {
    const R = Math.max(1, (opts.brushSize / 2 ** layer) * opts.scale); // Pinselbreite in Render-px
    const ref = boxBlur(rgb, w, h, R * 0.5);
    // Luminanzgradient des Referenzbildes (für Richtung „quer zum Gradienten“)
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = lumOf(ref, i);
    const makeStroke = (sx: number, sy: number, Rw: number, lay: number): Stroke => {
      const at = (x: number, y: number) =>
        Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)));
      const i0 = at(sx, sy);
      const jit = (k: number) => 1 + (rand() - 0.5) * 2 * opts.jitter * 0.12 * (k === 1 ? 1 : 0.8);
      const color: [number, number, number] = [
        Math.max(0, (ref[i0 * 3] ?? 0) * jit(0)),
        Math.max(0, (ref[i0 * 3 + 1] ?? 0) * jit(1)),
        Math.max(0, (ref[i0 * 3 + 2] ?? 0) * jit(2)),
      ];
      const points = [sx, sy];
      let x = sx;
      let y = sy;
      let dxPrev = 0;
      let dyPrev = 0;
      const maxLen = Math.max(1, Math.round(opts.length));
      for (let k = 1; k <= maxLen; k++) {
        const i = at(x, y);
        if (k > 1) {
          const dRef = dist(
            ref[i * 3] ?? 0,
            ref[i * 3 + 1] ?? 0,
            ref[i * 3 + 2] ?? 0,
            canvas[i * 3] ?? 0,
            canvas[i * 3 + 1] ?? 0,
            canvas[i * 3 + 2] ?? 0,
          );
          const dCol = dist(
            ref[i * 3] ?? 0,
            ref[i * 3 + 1] ?? 0,
            ref[i * 3 + 2] ?? 0,
            color[0],
            color[1],
            color[2],
          );
          if (dRef < dCol) break;
        }
        let dx: number;
        let dy: number;
        if (opts.direction === 'flow' && flow) {
          dx = (flow[i * 4 + 1] ?? 0.5) * 2 - 1;
          dy = (flow[i * 4 + 2] ?? 0.5) * 2 - 1;
        } else {
          const xl = at(x - 1, y);
          const xr = at(x + 1, y);
          const yu = at(x, y - 1);
          const yd = at(x, y + 1);
          const gx = (lum[xr] ?? 0) - (lum[xl] ?? 0);
          const gy = (lum[yd] ?? 0) - (lum[yu] ?? 0);
          if (Math.hypot(gx, gy) < 1e-5) break;
          dx = -gy;
          dy = gx;
        }
        const l = Math.hypot(dx, dy);
        if (l < 1e-6) break;
        dx /= l;
        dy /= l;
        // Richtung beibehalten (Feld ist vorzeichenlos), Krümmung begrenzen
        if (k > 1 && dx * dxPrev + dy * dyPrev < 0) {
          dx = -dx;
          dy = -dy;
        }
        if (k > 1) {
          const c = opts.curvature;
          dx = c * dx + (1 - c) * dxPrev;
          dy = c * dy + (1 - c) * dyPrev;
          const l2 = Math.hypot(dx, dy) || 1;
          dx /= l2;
          dy /= l2;
        }
        x += dx * Rw;
        y += dy * Rw;
        if (x < -Rw || y < -Rw || x > w + Rw || y > h + Rw) break;
        points.push(x, y);
        dxPrev = dx;
        dyPrev = dy;
      }
      return { points, width: Rw, color, layer: lay, order: 0 };
    };
    const grid = Math.max(1, R);
    const layerStrokes: Stroke[] = [];
    // Raster an der Leinwand ausgerichtet
    const gx0 = Math.floor(ox / grid) * grid - ox;
    const gy0 = Math.floor(oy / grid) * grid - oy;
    for (let cy = gy0; cy < h; cy += grid)
      for (let cx = gx0; cx < w; cx += grid) {
        const x0 = Math.max(0, Math.floor(cx));
        const y0 = Math.max(0, Math.floor(cy));
        const x1 = Math.min(w, Math.floor(cx + grid));
        const y1 = Math.min(h, Math.floor(cy + grid));
        if (x1 <= x0 || y1 <= y0) continue;
        let sum = 0;
        let cnt = 0;
        let best = -1;
        let bx = x0;
        let by = y0;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const i = y * w + x;
            const e = dist(
              canvas[i * 3] ?? 0,
              canvas[i * 3 + 1] ?? 0,
              canvas[i * 3 + 2] ?? 0,
              ref[i * 3] ?? 0,
              ref[i * 3 + 1] ?? 0,
              ref[i * 3 + 2] ?? 0,
            );
            sum += e;
            cnt++;
            if (e > best) {
              best = e;
              bx = x;
              by = y;
            }
          }
        if (cnt === 0 || sum / cnt <= threshold) continue;
        layerStrokes.push(makeStroke(bx + 0.5, by + 0.5, R, layer));
      }
    // Striche einer Schicht in zufälliger (reproduzierbarer) Reihenfolge auftragen
    for (let i = layerStrokes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = layerStrokes[i];
      layerStrokes[i] = layerStrokes[j] as Stroke;
      layerStrokes[j] = t as Stroke;
    }
    for (const s of layerStrokes) {
      s.order = strokes.length;
      strokes.push(s);
      paint(s);
    }
    progress((layer + 1) / levels);
  }
  return strokes;
}
