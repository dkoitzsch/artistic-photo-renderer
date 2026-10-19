// Malplan (Spec „Effekte & Malvorlagen“, Abschnitt 7): Einstellungen im Projekt, Untergrundformate, Zuschnitt.
// Reine Logik ohne Abhängigkeiten von Oberfläche oder GPU.

import { pigmentById } from '../pigments/engine';

export type Technique = 'oil' | 'acrylic' | 'watercolor' | 'gouache' | 'pencil';

export const TECHNIQUES: { value: Technique; label: string }[] = [
  { value: 'oil', label: 'Öl' },
  { value: 'acrylic', label: 'Acryl' },
  { value: 'watercolor', label: 'Aquarell' },
  { value: 'gouache', label: 'Gouache' },
  { value: 'pencil', label: 'Bleistift/Kohle' },
];

/** Untergrundformate in cm (Hochformat: Breite ≤ Höhe; die Ausrichtung folgt dem Bild). */
export type FormatPreset = { id: string; label: string; group: string; w: number; h: number };

export const FORMAT_PRESETS: FormatPreset[] = [
  ...(
    [
      [18, 24],
      [24, 30],
      [30, 40],
      [40, 50],
      [50, 60],
      [50, 70],
      [60, 80],
      [70, 100],
      [80, 100],
      [100, 120],
    ] as const
  ).map(([w, h]) => ({ id: `frame-${w}x${h}`, label: `${w} × ${h} cm`, group: 'Keilrahmen', w, h })),
  ...([30, 40, 50, 60, 80, 100] as const).map((s) => ({
    id: `square-${s}`,
    label: `${s} × ${s} cm`,
    group: 'Keilrahmen quadratisch',
    w: s,
    h: s,
  })),
  { id: 'a5', label: 'A5 (14,8 × 21 cm)', group: 'Papier', w: 14.8, h: 21 },
  { id: 'a4', label: 'A4 (21 × 29,7 cm)', group: 'Papier', w: 21, h: 29.7 },
  { id: 'a3', label: 'A3 (29,7 × 42 cm)', group: 'Papier', w: 29.7, h: 42 },
  { id: 'a2', label: 'A2 (42 × 59,4 cm)', group: 'Papier', w: 42, h: 59.4 },
  { id: 'wc-24x32', label: 'Aquarellblock 24 × 32 cm', group: 'Papier', w: 24, h: 32 },
  { id: 'wc-31x41', label: 'Aquarellblock 31 × 41 cm', group: 'Papier', w: 31, h: 41 },
  { id: 'wc-36x48', label: 'Aquarellblock 36 × 48 cm', group: 'Papier', w: 36, h: 48 },
];

/** Zuschnitt als Rechteck in normierten Leinwand-Koordinaten (0..1). */
export type Rect01 = { x: number; y: number; width: number; height: number };

export type HelpId =
  'final' | 'notan' | 'values' | 'scale' | 'warmcold' | 'palette' | 'numbers' | 'grid' | 'contour';

export const HELPS: { id: HelpId; label: string }[] = [
  { id: 'final', label: 'Endbild' },
  { id: 'notan', label: 'Notan' },
  { id: 'values', label: 'Werteskizze' },
  { id: 'scale', label: 'Wertskala' },
  { id: 'warmcold', label: 'Warm-Kalt-Karte' },
  { id: 'palette', label: 'Reduzierte Palette' },
  { id: 'numbers', label: 'Farbfeld-Karte' },
  { id: 'grid', label: 'Proportionsraster' },
  { id: 'contour', label: 'Konturvorlage' },
];

export type PaperSize = 'A4' | 'A3';
export type PdfPage = 'cover' | 'values' | 'notan' | 'warmcold' | 'grid' | 'gridSheet' | 'contour';

export const PDF_PAGES: { id: PdfPage; label: string }[] = [
  { id: 'cover', label: 'Deckblatt (Endbild)' },
  { id: 'values', label: 'Werteskizze mit Wertskala' },
  { id: 'notan', label: 'Notan' },
  { id: 'warmcold', label: 'Warm-Kalt-Karte' },
  { id: 'grid', label: 'Endbild mit Proportionsraster' },
  { id: 'gridSheet', label: 'Raster als eigenes Blatt' },
  { id: 'contour', label: 'Konturvorlage in Originalgröße (gekachelt)' },
];

export type Corner = [number, number];

export type MalplanSettings = {
  technique: Technique;
  /** Untergrund in cm; presetId null = freie Eingabe */
  format: { widthCm: number; heightCm: number; presetId: string | null };
  /** Zuschnitt des Bildes auf das Seitenverhältnis des Untergrunds */
  crop: Rect01;
  /** Vereinfachungsgrad: Anzahl Formen (20–2000) und Farben (4–40) */
  shapes: number;
  colors: number;
  /** „Meine Farben“: vorhandene Tubenfarben (Pigment-IDs der Pigmentdatenbank) */
  myColors: string[];
  notan: { threshold: number };
  values: { levels: 3 | 4 | 5; minArea: number };
  grid: { mode: 'divisions' | 'spacing'; cols: number; rows: number; spacingCm: number };
  contour: { lineWidthMm: number; paper: PaperSize; overlapCm: number };
  beamer: { help: HelpId; corners: [Corner, Corner, Corner, Corner]; grid: boolean };
  pdf: { pages: Record<PdfPage, boolean>; paper: PaperSize };
};

/** Standard für „Meine Farben“: übliche Grundpalette aus 10 Farben */
export const DEFAULT_MY_COLORS = [
  'titanium-white',
  'ivory-black',
  'ultramarine',
  'phthalo-blue',
  'cadmium-yellow-light',
  'yellow-ochre',
  'burnt-sienna',
  'cadmium-red-light',
  'alizarin-permanent',
  'phthalo-green',
] as const;

export const SHAPES_RANGE = [20, 2000] as const;
export const COLORS_RANGE = [4, 40] as const;

/** Standardeinstellungen; das Format folgt der Ausrichtung des Bildes (Hoch/Quer). */
export function defaultMalplan(canvas: { width: number; height: number }): MalplanSettings {
  const landscape = canvas.width > canvas.height;
  const format = { widthCm: landscape ? 40 : 30, heightCm: landscape ? 30 : 40, presetId: 'frame-30x40' };
  return {
    technique: 'acrylic',
    format,
    crop: fitCrop(canvas, format.widthCm / format.heightCm),
    shapes: 200,
    colors: 12,
    myColors: [...DEFAULT_MY_COLORS],
    notan: { threshold: 0.5 },
    values: { levels: 4, minArea: 0.2 },
    grid: { mode: 'divisions', cols: 4, rows: 4, spacingCm: 5 },
    contour: { lineWidthMm: 0.35, paper: 'A4', overlapCm: 1 },
    beamer: {
      help: 'contour',
      corners: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      grid: false,
    },
    pdf: {
      pages: {
        cover: true,
        values: true,
        notan: true,
        warmcold: true,
        grid: true,
        gridSheet: true,
        contour: true,
      },
      paper: 'A4',
    },
  };
}

/** Größter zentrierter Zuschnitt mit Seitenverhältnis aspect (Breite/Höhe in cm) in normierten Koordinaten. */
export function fitCrop(canvas: { width: number; height: number }, aspect: number): Rect01 {
  const canvasAspect = canvas.width / canvas.height;
  if (aspect >= canvasAspect) {
    const h = canvasAspect / aspect;
    return { x: 0, y: (1 - h) / 2, width: 1, height: h };
  }
  const w = aspect / canvasAspect;
  return { x: (1 - w) / 2, y: 0, width: w, height: 1 };
}

/**
 * Passt einen Zuschnitt an ein neues Seitenverhältnis an: Mitte bleibt, Größe so groß wie möglich innerhalb des
 * Bildes und höchstens so groß wie die Fläche des bisherigen Zuschnitts erlaubt (bei gleichem Verhältnis unverändert).
 */
export function adaptCrop(crop: Rect01, canvas: { width: number; height: number }, aspect: number): Rect01 {
  const canvasAspect = canvas.width / canvas.height;
  // Breite/Höhe des Zuschnitts in normierten Einheiten für ein Seitenverhältnis in Leinwand-px
  const rel = aspect / canvasAspect; // = width01 / height01
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  const area = crop.width * crop.height;
  let h = Math.sqrt(area / rel);
  let w = h * rel;
  const scale = Math.min(1, 1 / w, 1 / h);
  w *= scale;
  h *= scale;
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, width: w, height: h });
}

/** Verschiebt einen Zuschnitt in das Bild (Größe bleibt, höchstens 1 × 1). */
export function clampCrop(c: Rect01): Rect01 {
  const width = Math.min(1, Math.max(0.01, c.width));
  const height = Math.min(1, Math.max(0.01, c.height));
  return {
    x: Math.min(1 - width, Math.max(0, c.x)),
    y: Math.min(1 - height, Math.max(0, c.y)),
    width,
    height,
  };
}

/** Format so ausrichten, dass Hoch-/Querformat zum Zuschnitt des Bildes passt. */
export function orientFormat(w: number, h: number, landscape: boolean): [number, number] {
  const a = Math.min(w, h);
  const b = Math.max(w, h);
  return landscape ? [b, a] : [a, b];
}

/** Rasterlinien (cm ab linkem/oberem Rand) für das Proportionsraster. */
export function gridLines(s: MalplanSettings): { xs: number[]; ys: number[] } {
  const { widthCm: W, heightCm: H } = s.format;
  const lines = (total: number, n: number, step: number) => {
    const out: number[] = [];
    if (s.grid.mode === 'divisions') {
      for (let i = 1; i < n; i++) out.push((total * i) / n);
    } else {
      for (let v = step; v < total - 1e-6; v += step) out.push(v);
    }
    return out;
  };
  return {
    xs: lines(W, Math.max(1, s.grid.cols), Math.max(0.5, s.grid.spacingCm)),
    ys: lines(H, Math.max(1, s.grid.rows), Math.max(0.5, s.grid.spacingCm)),
  };
}

/** Prüft und ergänzt gespeicherte Malplan-Einstellungen (ältere/unvollständige Projekte). */
export function normalizeMalplan(raw: unknown, canvas: { width: number; height: number }): MalplanSettings {
  const d = defaultMalplan(canvas);
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Partial<MalplanSettings>;
  const num = (v: unknown, lo: number, hi: number, fb: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
  const technique = TECHNIQUES.some((t) => t.value === r.technique)
    ? (r.technique as Technique)
    : d.technique;
  const format = {
    widthCm: num(r.format?.widthCm, 5, 500, d.format.widthCm),
    heightCm: num(r.format?.heightCm, 5, 500, d.format.heightCm),
    presetId: typeof r.format?.presetId === 'string' ? r.format.presetId : null,
  };
  const crop = r.crop
    ? clampCrop({
        x: num(r.crop.x, 0, 1, 0),
        y: num(r.crop.y, 0, 1, 0),
        width: num(r.crop.width, 0.01, 1, 1),
        height: num(r.crop.height, 0.01, 1, 1),
      })
    : fitCrop(canvas, format.widthCm / format.heightCm);
  const levels = r.values?.levels;
  const corners: unknown = r.beamer?.corners;
  const okCorners =
    Array.isArray(corners) &&
    corners.length === 4 &&
    corners.every(
      (c: unknown) => Array.isArray(c) && c.length === 2 && c.every((v: unknown) => typeof v === 'number'),
    );
  return {
    technique,
    format,
    crop,
    shapes: Math.round(num(r.shapes, SHAPES_RANGE[0], SHAPES_RANGE[1], d.shapes)),
    colors: Math.round(num(r.colors, COLORS_RANGE[0], COLORS_RANGE[1], d.colors)),
    myColors: (() => {
      const list = Array.isArray(r.myColors)
        ? r.myColors.filter((id): id is string => typeof id === 'string' && pigmentById(id) !== undefined)
        : [];
      return list.length ? [...new Set(list)] : d.myColors;
    })(),
    notan: { threshold: num(r.notan?.threshold, 0, 1, d.notan.threshold) },
    values: {
      levels: levels === 3 || levels === 4 || levels === 5 ? levels : d.values.levels,
      minArea: num(r.values?.minArea, 0, 5, d.values.minArea),
    },
    grid: {
      mode: r.grid?.mode === 'spacing' ? 'spacing' : 'divisions',
      cols: Math.round(num(r.grid?.cols, 1, 20, d.grid.cols)),
      rows: Math.round(num(r.grid?.rows, 1, 20, d.grid.rows)),
      spacingCm: num(r.grid?.spacingCm, 0.5, 50, d.grid.spacingCm),
    },
    contour: {
      lineWidthMm: num(r.contour?.lineWidthMm, 0.1, 2, d.contour.lineWidthMm),
      paper: r.contour?.paper === 'A3' ? 'A3' : 'A4',
      overlapCm: num(r.contour?.overlapCm, 0, 5, d.contour.overlapCm),
    },
    beamer: {
      help: HELPS.some((h) => h.id === r.beamer?.help) ? (r.beamer?.help as HelpId) : d.beamer.help,
      corners: okCorners ? (corners as MalplanSettings['beamer']['corners']) : d.beamer.corners,
      grid: r.beamer?.grid === true,
    },
    pdf: {
      pages: Object.fromEntries(
        PDF_PAGES.map((p) => {
          const v: unknown = (r.pdf?.pages as Record<string, unknown> | undefined)?.[p.id];
          return [p.id, typeof v === 'boolean' ? v : true];
        }),
      ) as Record<PdfPage, boolean>,
      paper: r.pdf?.paper === 'A3' ? 'A3' : 'A4',
    },
  };
}
