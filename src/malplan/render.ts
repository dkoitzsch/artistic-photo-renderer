// Zeichnet die Malplan-Hilfen als Bilder (Canvas 2D): Endbild, Notan, Werteskizze, Wertskala, Warm-Kalt-Karte,
// Proportionsraster und Konturvorlage. Größe = Analysegröße; die Kontur kann größer gezeichnet werden.

import { linearFromOklab, srgbFromOklab, warmth } from './analysis';
import { gridLines, type HelpId, type MalplanSettings } from './model';
import type { MalplanDerived, MalplanPalette, MalplanResult } from './store';

/** Papier und Tusche der Hilfen (sRGB 0..255) */
export const PAPER: [number, number, number] = [250, 248, 243];
export const INK: [number, number, number] = [28, 27, 26];

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);
const to8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Grauwert (sRGB 0..1) mit der wahrgenommenen Helligkeit L (Oklab). */
export function grayOfL(L: number): number {
  return enc(linearFromOklab(L, 0, 0)[0]);
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  return [c, g];
}

/** Farbe je Pixel aus einer Stufe je Pixel (Tabelle). */
function fromMap(
  w: number,
  h: number,
  map: Uint8Array,
  colors: [number, number, number][],
): HTMLCanvasElement {
  const [c, g] = canvasOf(w, h);
  const img = g.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const col = colors[map[p] ?? 0] ?? PAPER;
    img.data[p * 4] = col[0];
    img.data[p * 4 + 1] = col[1];
    img.data[p * 4 + 2] = col[2];
    img.data[p * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Graustufen der Tonwerte (dunkel → hell), die die Werteskizze verwendet. */
export function toneGrays(d: MalplanDerived): [number, number, number][] {
  return d.tones.map((L) => {
    const v = to8(grayOfL(L));
    return [v, v, v];
  });
}

export function renderNotan(r: MalplanResult, d: MalplanDerived): HTMLCanvasElement {
  return fromMap(r.width, r.height, d.notan, [INK, PAPER]);
}

export function renderValues(r: MalplanResult, d: MalplanDerived): HTMLCanvasElement {
  return fromMap(r.width, r.height, d.values, toneGrays(d));
}

/** Farbe der Warm-Kalt-Karte: gleiche Helligkeit, Farbton Orange (warm) bzw. Blau (kalt), Grau = neutral. */
export function warmColor(t: number): [number, number, number] {
  const axis = (60 * Math.PI) / 180;
  const c = 0.13 * Math.abs(t);
  const a = t >= 0 ? Math.cos(axis) * c : -Math.cos(axis) * c;
  const b = t >= 0 ? Math.sin(axis) * c : -Math.sin(axis) * c;
  const rgb = srgbFromOklab([0.72, a, b]);
  return [to8(rgb[0]), to8(rgb[1]), to8(rgb[2])];
}

export function renderWarmCold(r: MalplanResult): HTMLCanvasElement {
  const colors = r.regions.map((reg) => warmColor(warmth(reg.lab)));
  const [c, g] = canvasOf(r.width, r.height);
  const img = g.createImageData(r.width, r.height);
  for (let p = 0; p < r.width * r.height; p++) {
    const col = colors[r.labels[p] ?? 0] ?? PAPER;
    img.data[p * 4] = col[0];
    img.data[p * 4 + 1] = col[1];
    img.data[p * 4 + 2] = col[2];
    img.data[p * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Flächengrenzen dünn, damit die Formen lesbar bleiben
  drawContours(g, r.contours, r.width, r.height, 1, 'rgba(0,0,0,0.25)');
  return c;
}

export function renderFinal(r: MalplanResult): HTMLCanvasElement {
  const [c, g] = canvasOf(r.width, r.height);
  g.putImageData(r.image, 0, 0);
  return c;
}

export function drawContours(
  g: CanvasRenderingContext2D,
  lines: Float32Array[],
  w: number,
  h: number,
  width: number,
  color: string,
): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  for (const l of lines) {
    g.moveTo((l[0] ?? 0) * w, (l[1] ?? 0) * h);
    for (let i = 2; i < l.length; i += 2) g.lineTo((l[i] ?? 0) * w, (l[i + 1] ?? 0) * h);
  }
  g.stroke();
  g.restore();
}

/** Konturvorlage: Linien der Hauptformen auf Papier (scale = Pixel je Analyse-Pixel). */
export function renderContour(r: MalplanResult, scale = 2): HTMLCanvasElement {
  const w = Math.round(r.width * scale);
  const h = Math.round(r.height * scale);
  const [c, g] = canvasOf(w, h);
  g.fillStyle = `rgb(${PAPER.join(',')})`;
  g.fillRect(0, 0, w, h);
  drawContours(g, r.contours, w, h, Math.max(1, scale * 0.9), `rgb(${INK.join(',')})`);
  g.strokeStyle = `rgb(${INK.join(',')})`;
  g.lineWidth = Math.max(1, scale);
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
  return c;
}

/** Proportionsraster über einem Bild (Linien in cm des Untergrunds, beschriftet). */
export function drawGrid(g: CanvasRenderingContext2D, w: number, h: number, s: MalplanSettings): void {
  const { xs, ys } = gridLines(s);
  const sx = w / s.format.widthCm;
  const sy = h / s.format.heightCm;
  g.save();
  const lw = Math.max(1, Math.round(Math.min(w, h) / 600));
  g.lineWidth = lw * 2;
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  const path = () => {
    g.beginPath();
    for (const x of xs) {
      g.moveTo(x * sx, 0);
      g.lineTo(x * sx, h);
    }
    for (const y of ys) {
      g.moveTo(0, y * sy);
      g.lineTo(w, y * sy);
    }
  };
  path();
  g.stroke();
  g.lineWidth = lw;
  g.strokeStyle = 'rgba(20,20,20,0.85)';
  path();
  g.stroke();
  // Felder beschriften: Spalten A, B, …; Zeilen 1, 2, …
  const font = Math.max(10, Math.round(Math.min(w, h) / 40));
  g.font = `600 ${font}px "Inter Variable", system-ui, sans-serif`;
  g.textBaseline = 'top';
  const cols = [0, ...xs];
  const rows = [0, ...ys];
  cols.forEach((x, i) => {
    const label = String.fromCharCode(65 + (i % 26));
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(x * sx + 2, 2, font * 0.9, font * 1.1);
    g.fillStyle = 'rgb(20,20,20)';
    g.fillText(label, x * sx + 4, 3);
  });
  rows.forEach((y, i) => {
    const label = String(i + 1);
    // erste Zeile unter der Spaltenbeschriftung „A“
    const top = y * sy + (i === 0 ? font * 1.3 : 2);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(2, top, font * 1.4, font * 1.1);
    g.fillStyle = 'rgb(20,20,20)';
    g.fillText(label, 4, top + 1);
  });
  g.restore();
}

export function renderGrid(r: MalplanResult, s: MalplanSettings): HTMLCanvasElement {
  const c = renderFinal(r);
  const g = c.getContext('2d');
  if (g) drawGrid(g, c.width, c.height, s);
  return c;
}

/** Wertskala: Graukeil der verwendeten Stufen (hell → dunkel), nummeriert, zum Ausdrucken und Abgleichen. */
export function renderScale(d: MalplanDerived, w = 1200): HTMLCanvasElement {
  const grays = toneGrays(d).reverse();
  const n = grays.length;
  const h = Math.round(w / Math.max(3, n) + 70);
  const [c, g] = canvasOf(w, h);
  g.fillStyle = `rgb(${PAPER.join(',')})`;
  g.fillRect(0, 0, w, h);
  const box = (w - 40) / n;
  g.font = '600 22px "Inter Variable", system-ui, sans-serif';
  g.textAlign = 'center';
  grays.forEach((col, i) => {
    const x = 20 + i * box;
    g.fillStyle = `rgb(${col.join(',')})`;
    g.fillRect(x, 20, box, box * 0.8);
    g.strokeStyle = 'rgb(40,40,40)';
    g.lineWidth = 2;
    g.strokeRect(x, 20, box, box * 0.8);
    g.fillStyle = 'rgb(30,30,30)';
    g.fillText(`${i + 1}`, x + box / 2, 20 + box * 0.8 + 12);
  });
  return c;
}

/** Reduzierte Palette: jede Fläche in der Mischfarbe ihres Paletteneintrags. */
export function renderPalette(r: MalplanResult, pal: MalplanPalette): HTMLCanvasElement {
  const colors = pal.entries.map((e) => e.mixed.map(to8) as [number, number, number]);
  const map = new Uint8Array(r.width * r.height);
  for (let p = 0; p < map.length; p++) map[p] = pal.regionEntry[r.labels[p] ?? 0] ?? 0;
  return fromMap(r.width, r.height, map, colors);
}

/**
 * Farbfeld-Karte: Flächenumrisse mit der Nummer ihres Paletteneintrags (im innersten Punkt der Fläche); sehr kleine
 * Flächen bleiben ohne Nummer. scale = Pixel je Analyse-Pixel.
 */
export function renderNumbers(r: MalplanResult, pal: MalplanPalette, scale = 2): HTMLCanvasElement {
  const w = Math.round(r.width * scale);
  const h = Math.round(r.height * scale);
  const [c, g] = canvasOf(w, h);
  g.fillStyle = `rgb(${PAPER.join(',')})`;
  g.fillRect(0, 0, w, h);
  drawContours(g, r.contours, w, h, Math.max(1, scale * 0.6), 'rgb(120,118,114)');
  g.fillStyle = `rgb(${INK.join(',')})`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < r.regions.length; i++) {
    const rad = (pal.labelPoints[i * 3 + 2] ?? 0) * scale;
    if (rad < 5) continue;
    const size = Math.min(22 * scale, Math.max(8, rad * 0.9));
    g.font = `${Math.round(size)}px Helvetica, Arial, sans-serif`;
    const n = (pal.entries[pal.regionEntry[i] ?? 0]?.number ?? 0).toString();
    g.fillText(n, (pal.labelPoints[i * 3] ?? 0) * scale, (pal.labelPoints[i * 3 + 1] ?? 0) * scale);
  }
  g.strokeStyle = `rgb(${INK.join(',')})`;
  g.lineWidth = Math.max(1, scale);
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
  return c;
}

/** Bild einer Hilfe (ohne Rasterüberlagerung) oder null, solange die Analyse fehlt. */
export function renderHelp(
  help: HelpId,
  r: MalplanResult | null,
  d: MalplanDerived | null,
  s: MalplanSettings,
  pal: MalplanPalette | null = null,
): HTMLCanvasElement | null {
  if (!r) return null;
  switch (help) {
    case 'palette':
      return pal ? renderPalette(r, pal) : null;
    case 'numbers':
      return pal ? renderNumbers(r, pal) : null;
    case 'final':
      return renderFinal(r);
    case 'grid':
      return renderGrid(r, s);
    case 'contour':
      return renderContour(r);
    case 'warmcold':
      return renderWarmCold(r);
    case 'notan':
      return d ? renderNotan(r, d) : null;
    case 'values':
      return d ? renderValues(r, d) : null;
    case 'scale':
      return d ? renderScale(d) : null;
  }
}
