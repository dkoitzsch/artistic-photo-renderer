// PDF-Malmappe (Spec 7.8): Deckblatt, Werteskizze mit Wertskala, Notan, Warm-Kalt-Karte, Palette mit Mischrezepten,
// Farbfeld-Karte, Kanten-Karte, Schichtplan (eine Seite je Schritt), Strichführung, Endbild mit Raster, Raster als
// eigenes Blatt und die Konturvorlage in Originalgröße, gekachelt mit Überlappung und Passmarken.

import { PAPER_PT, PdfDocument, PT_PER_CM, textWidth, type PdfImage, type PdfPage } from '../io/pdf';
import { gridLines, PDF_PAGES, TECHNIQUES, type MalplanSettings, type PdfPage as PageId } from './model';
import { pigmentById, recipeParts } from '../pigments/engine';
import {
  EDGE_COLORS,
  GUIDE_COLORS,
  renderEdges,
  renderNotan,
  renderNumbers,
  renderPalette,
  renderStep,
  renderStrokes,
  renderValues,
  renderWarmCold,
  toneGrays,
  warmColor,
  type HelpExtras,
} from './render';
import type { MalplanDerived, MalplanPalette, MalplanResult } from './store';
import { tileLayout, tileName, tileOrigin } from './tiles';

const MARGIN = 36; // pt (≈ 1,27 cm) für Bildseiten
const INK: [number, number, number] = [0.11, 0.11, 0.1];
const MUTED: [number, number, number] = [0.42, 0.42, 0.4];

type Ctx = {
  doc: PdfDocument;
  s: MalplanSettings;
  r: MalplanResult;
  d: MalplanDerived;
  x: HelpExtras;
  name: string;
  pageNo: number;
};

/** Zerlegt einen Text in Zeilen bis maxWidth (pt). */
function wrap(text: string, maxWidth: number, size: number, bold = false): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const rgb01 = (c: readonly number[]): [number, number, number] => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];

/** Rezept als Text (Teile, „etwas“) */
function recipeText(e: MalplanPalette['entries'][number]): string {
  return recipeParts({
    parts: e.recipe,
    deltaE: e.deltaE,
    result: { srgb: e.mixed, hex: '', lab: [0, 0, 0], spectrum: new Float64Array() },
  })
    .map((p) =>
      p.parts === null ? `etwas ${p.name}` : `${p.parts} ${p.parts === 1 ? 'Teil' : 'Teile'} ${p.name}`,
    )
    .join(' + ');
}

/** Palette mit Mischrezepten: kleines Bild der reduzierten Palette, Tabelle (ggf. über mehrere Seiten), Meine Farben. */
function palettePages(ctx: Ctx, pal: MalplanPalette) {
  const rowH = 30;
  let i = 0;
  let first = true;
  while (i < pal.entries.length || first) {
    const { p, area } = pageFor(
      ctx,
      first ? `Palette und Mischrezepte (${pal.entries.length} Farben)` : 'Mischrezepte (Fortsetzung)',
      false,
    );
    const [x, y, w, h] = area;
    let top = y + h;
    if (first) {
      const img = renderPalette(ctx.r, pal);
      const ih = Math.min(h * 0.32, (w * img.height) / img.width);
      const iw = (ih * img.width) / img.height;
      p.image(embedCanvas(ctx.doc, img), x, top - ih, iw, ih);
      p.stroke([0.75, 0.75, 0.72], 0.5).rect(x, top - ih, iw, ih);
      const note = wrap(
        'Jede Fläche in der Mischfarbe ihres Eintrags. Farbfeld links = Sollfarbe aus dem Bild, rechts = Mischung aus „Meine Farben“. dE = Farbabstand (CIEDE2000); ab 5 sichtbar abweichend. Die Pigmentspektren sind Näherungen.',
        w - iw - 16,
        8,
      );
      note.forEach((l, k) => p.text(l, x + iw + 16, top - 10 - k * 11, 8, false, MUTED));
      top -= ih + 22;
    }
    while (i < pal.entries.length && top - rowH > y + (first ? 70 : 0)) {
      const e = pal.entries[i];
      if (!e) break;
      const ry = top - rowH;
      p.text(String(e.number), x, ry + 10, 11, true, INK);
      p.fill(rgb01(e.target))
        .stroke(INK, 0.4)
        .rect(x + 24, ry + 2, 20, 20, 'B');
      p.fill(rgb01(e.mixed))
        .stroke(INK, 0.4)
        .rect(x + 44, ry + 2, 20, 20, 'B');
      const lines = wrap(recipeText(e), w - 150, 9);
      lines.slice(0, 2).forEach((l, k) => p.text(l, x + 76, ry + 14 - k * 11, 9, false, INK));
      const off = e.deltaE >= 5;
      p.text(`dE ${e.deltaE.toFixed(1)}`, x + w - 60, ry + 10, 9, off, off ? [0.75, 0.1, 0.1] : MUTED);
      if (off) p.text('nicht genau mischbar', x + w - 110, ry, 7, false, [0.75, 0.1, 0.1]);
      top -= rowH;
      i++;
    }
    if (first) {
      // Meine Farben (Fußbereich der ersten Seite)
      const names = ctx.s.myColors.map((id) => {
        const pg = pigmentById(id);
        return pg ? `${pg.name} (${pg.ci})` : id;
      });
      p.text('Meine Farben', x, y + 52, 9, true, INK);
      wrap(names.join(' · '), w, 8)
        .slice(0, 4)
        .forEach((l, k) => p.text(l, x, y + 40 - k * 10, 8, false, INK));
    }
    first = false;
  }
}

/** Farbfeld-Karte mit Legende (Nummer → Mischfarbe). */
function numbersPage(ctx: Ctx, pal: MalplanPalette) {
  const cols = 6;
  const rows = Math.ceil(pal.entries.length / cols);
  const reserve = 20 + rows * 18;
  const { p, box } = imagePage(ctx, 'Farbfeld-Karte', renderNumbers(ctx.r, pal, 3), reserve);
  const [bx, by, bw] = box;
  const cw = bw / cols;
  pal.entries.forEach((e, k) => {
    const cx = bx + (k % cols) * cw;
    const cy = by - 22 - Math.floor(k / cols) * 18;
    p.fill(rgb01(e.mixed)).stroke(INK, 0.4).rect(cx, cy, 14, 12, 'B');
    p.text(String(e.number), cx + 18, cy + 2, 9, true, INK);
  });
}

/** Kanten-Karte mit Legende. */
function edgesPage(ctx: Ctx) {
  const edges = ctx.x.edges;
  if (!edges) return;
  const { p, box } = imagePage(ctx, 'Kanten-Karte', renderEdges(ctx.r, edges, ctx.s), 40);
  const [bx, by] = box;
  const y = by - 18;
  const items: [1 | 2 | 3, string][] = [
    [1, 'hart – scharf malen'],
    [2, 'weich – verblenden'],
    [3, 'verloren – ineinander laufen lassen'],
  ];
  items.forEach(([k, label], i) => {
    const c = EDGE_COLORS[k];
    p.fill([c[0] / 255, c[1] / 255, c[2] / 255]).rect(bx + i * 170, y, 18, 5, 'f');
    p.text(label, bx + i * 170 + 24, y - 1, 9, false, INK);
  });
}

/** Schichtplan: eine Seite je Schritt (Stand mit neu hinzukommenden Flächen umrandet). */
function stepPages(ctx: Ctx) {
  const plan = ctx.x.plan;
  if (!plan) return;
  plan.steps.forEach((st, k) => {
    const { p, box } = imagePage(
      ctx,
      `Schichtplan – Schritt ${k + 1} von ${plan.steps.length}: ${st.title}`,
      renderStep(ctx.r, plan, k, ctx.s, ctx.x.palette ?? null),
      40,
    );
    const [bx, by, bw] = box;
    wrap(st.description, bw, 10).forEach((l, i) => p.text(l, bx, by - 16 - i * 12, 10, false, INK));
    if (st.kind === 'paint')
      p.text('Neu in diesem Schritt: umrandete Flächen.', bx, by - 42, 8, false, MUTED);
  });
}

/** Strichführung mit Legende (Pinselbreite in mm auf dem Untergrund). */
function strokesPage(ctx: Ctx) {
  const guide = ctx.x.guide;
  if (!guide) return;
  const { p, box } = imagePage(ctx, 'Strichführung', renderStrokes(ctx.r, guide), 46);
  const [bx, by] = box;
  const mm = (px: number) =>
    Math.max(1, Math.round((px * ctx.s.format.widthCm * 10) / Math.max(1, ctx.r.width)));
  const names =
    guide.source === 'stroke-paint'
      ? guide.widths.map((_, i) => `Durchgang ${i + 1}`)
      : ['große Flächen', 'mittlere Formen', 'Details'];
  guide.widths.forEach((w, i) => {
    const c = GUIDE_COLORS[i % GUIDE_COLORS.length] ?? [0, 0, 0];
    p.fill([c[0] / 255, c[1] / 255, c[2] / 255]).rect(bx + i * 170, by - 18, 18, 5, 'f');
    p.text(`${names[i] ?? ''}: Pinsel ca. ${mm(w)} mm`, bx + i * 170 + 24, by - 19, 9, false, INK);
  });
  p.text(
    guide.source === 'stroke-paint'
      ? 'Aus den Strichdaten des Effekts „Pinselstriche“: Richtung und Reihenfolge der Durchgänge.'
      : 'Richtung aus dem Richtungsfeld des Bildes; Pinselbreite nach Flächengröße.',
    bx,
    by - 36,
    8,
    false,
    MUTED,
  );
}

/** Bild eines Canvas verlustfrei einbetten. */
function embedCanvas(doc: PdfDocument, c: HTMLCanvasElement): PdfImage {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  return doc.addRgba(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

/** Seite in passender Ausrichtung mit Titel und Fußzeile; liefert den freien Bildbereich (x, y, w, h). */
function pageFor(
  ctx: Ctx,
  title: string,
  landscape: boolean,
): { p: PdfPage; area: [number, number, number, number] } {
  const [a, b] = PAPER_PT[ctx.s.pdf.paper];
  const [W, H] = landscape ? [b, a] : [a, b];
  const p = ctx.doc.addPage(W, H);
  ctx.pageNo++;
  p.text(title, MARGIN, H - MARGIN - 14, 16, true, INK);
  p.text(`${ctx.name} · Malmappe · Seite ${ctx.pageNo}`, MARGIN, MARGIN - 18, 8, false, MUTED);
  return { p, area: [MARGIN, MARGIN, W - 2 * MARGIN, H - 2 * MARGIN - 32] };
}

/** Bild eingepasst in den Bereich, oben ausgerichtet; liefert die Lage (x, y, w, h). */
function fitImage(
  p: PdfPage,
  img: PdfImage,
  aspect: number,
  area: [number, number, number, number],
): [number, number, number, number] {
  const [x, y, w, h] = area;
  let iw = w;
  let ih = w / aspect;
  if (ih > h) {
    ih = h;
    iw = h * aspect;
  }
  const ix = x + (w - iw) / 2;
  const iy = y + h - ih;
  p.image(img, ix, iy, iw, ih);
  p.stroke([0.75, 0.75, 0.72], 0.5).rect(ix, iy, iw, ih);
  return [ix, iy, iw, ih];
}

function imagePage(ctx: Ctx, title: string, c: HTMLCanvasElement, reserve = 0, note?: string) {
  const aspect = c.width / c.height;
  const { p, area } = pageFor(ctx, title, aspect > 1.05);
  const [x, y, w, h] = area;
  const box = fitImage(p, embedCanvas(ctx.doc, c), aspect, [x, y + reserve, w, h - reserve]);
  if (note) p.text(note, x, y + reserve - 14, 9, false, MUTED);
  return { p, box, area };
}

function cover(ctx: Ctx, jpeg: { data: Uint8Array; width: number; height: number }) {
  const { s } = ctx;
  const aspect = jpeg.width / jpeg.height;
  const { p, area } = pageFor(ctx, ctx.name, aspect > 1.05);
  const img = ctx.doc.addJpeg(jpeg.data, jpeg.width, jpeg.height);
  const [x, y, w, h] = area;
  fitImage(p, img, aspect, [x, y + 70, w, h - 80]);
  const technique = TECHNIQUES.find((t) => t.value === s.technique)?.label ?? s.technique;
  const fmt = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  p.text(
    `Malmappe · ${technique} · ${fmt(s.format.widthCm)} × ${fmt(s.format.heightCm)} cm`,
    x,
    y + 48,
    12,
    true,
    INK,
  );
  p.text(
    `${s.shapes} Formen, ${s.colors} Farben, ${s.values.levels} Tonwertstufen · erstellt am ${new Date().toLocaleDateString('de-DE')}`,
    x,
    y + 32,
    9,
    false,
    MUTED,
  );
  const pages = PDF_PAGES.filter((pg) => pg.id !== 'cover' && s.pdf.pages[pg.id]).map((pg) => pg.label);
  wrap(`Inhalt: ${pages.join(' · ')}`, w, 8)
    .slice(0, 2)
    .forEach((l, i) => p.text(l, x, y + 18 - i * 10, 8, false, MUTED));
}

function valuesPage(ctx: Ctx) {
  const grays = toneGrays(ctx.d).reverse();
  const { p, box } = imagePage(
    ctx,
    `Werteskizze (${ctx.d.tones.length} Tonwerte)`,
    renderValues(ctx.r, ctx.d),
    70,
  );
  // Wertskala unter dem Bild: hell (1) → dunkel (n)
  const [bx, by, bw] = box;
  const n = grays.length;
  const size = Math.min(48, (bw - 10) / n);
  const y = Math.max(MARGIN + 12, by - size - 24);
  p.text('Wertskala', bx, y + size + 6, 9, true, INK);
  grays.forEach((g, i) => {
    const x = bx + i * size;
    p.fill([g[0] / 255, g[1] / 255, g[2] / 255])
      .stroke(INK, 0.6)
      .rect(x, y, size, size, 'B');
    p.text(String(i + 1), x + size / 2 - 3, y - 11, 8, false, INK);
  });
}

function notanPage(ctx: Ctx) {
  imagePage(
    ctx,
    'Notan (zwei Werte)',
    renderNotan(ctx.r, ctx.d),
    24,
    'Dunkle und helle Großformen – das Gerüst der Komposition.',
  );
}

function warmColdPage(ctx: Ctx) {
  const { p, box } = imagePage(ctx, 'Warm-Kalt-Karte', renderWarmCold(ctx.r), 50);
  const [bx, by] = box;
  const y = Math.max(MARGIN + 12, by - 34);
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const t = -1 + (2 * i) / (steps - 1);
    const c = warmColor(t);
    p.fill([c[0] / 255, c[1] / 255, c[2] / 255]).rect(bx + 40 + i * 18, y, 18, 12, 'f');
  }
  p.text('kalt', bx, y + 2, 9, false, INK);
  p.text('warm', bx + 40 + steps * 18 + 6, y + 2, 9, false, INK);
  p.text(
    'Farbtemperatur unabhängig von der Helligkeit (OKLCh), grau = neutral.',
    bx,
    y - 14,
    8,
    false,
    MUTED,
  );
}

/** Endbild mit Raster (Vektorlinien, beschriftet). */
function gridPage(ctx: Ctx, final: HTMLCanvasElement) {
  const { s } = ctx;
  const { p, box } = imagePage(ctx, 'Endbild mit Proportionsraster', final, 24);
  const [bx, by, bw, bh] = box;
  const { xs, ys } = gridLines(s);
  const sx = bw / s.format.widthCm;
  const sy = bh / s.format.heightCm;
  p.stroke([1, 1, 1], 1.4);
  for (const x of xs) p.line(bx + x * sx, by, bx + x * sx, by + bh);
  for (const y of ys) p.line(bx, by + bh - y * sy, bx + bw, by + bh - y * sy);
  p.stroke(INK, 0.6);
  for (const x of xs) p.line(bx + x * sx, by, bx + x * sx, by + bh);
  for (const y of ys) p.line(bx, by + bh - y * sy, bx + bw, by + bh - y * sy);
  [0, ...xs].forEach((x, i) => {
    p.text(String.fromCharCode(65 + (i % 26)), bx + x * sx + 3, by + bh + 4, 8, true, INK);
  });
  [0, ...ys].forEach((y, i) => {
    p.text(String(i + 1), bx - 12, by + bh - y * sy - 10, 8, true, INK);
  });
}

/** Raster als eigenes Blatt: Format maßstäblich mit den Linienabständen in cm (zum Übertragen auf den Untergrund). */
function gridSheet(ctx: Ctx) {
  const { s } = ctx;
  const aspect = s.format.widthCm / s.format.heightCm;
  const { p, area } = pageFor(ctx, 'Raster für den Untergrund', aspect > 1.05);
  const [x, y, w, h] = area;
  const pad = 40;
  let fw = w - 2 * pad;
  let fh = fw / aspect;
  if (fh > h - 2 * pad - 30) {
    fh = h - 2 * pad - 30;
    fw = fh * aspect;
  }
  const fx = x + (w - fw) / 2;
  const fy = y + h - pad - fh;
  const k = fw / s.format.widthCm;
  p.stroke(INK, 1.2).rect(fx, fy, fw, fh);
  const { xs, ys } = gridLines(s);
  const fmt = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  p.stroke(INK, 0.6);
  for (const v of xs) {
    p.line(fx + v * k, fy, fx + v * k, fy + fh);
    const label = `${fmt(v)} cm`;
    p.text(label, fx + v * k - textWidth(label, 7) / 2, fy + fh + 6, 7, false, MUTED);
  }
  for (const v of ys) {
    p.line(fx, fy + fh - v * k, fx + fw, fy + fh - v * k);
    const label = `${fmt(v)} cm`;
    p.text(label, fx - textWidth(label, 7) - 4, fy + fh - v * k - 2, 7, false, MUTED);
  }
  p.text(
    `Untergrund ${fmt(s.format.widthCm)} × ${fmt(s.format.heightCm)} cm (verkleinert). Abstände ab der oberen linken Ecke.`,
    x,
    fy - 22,
    9,
    false,
    INK,
  );
}

/** Konturvorlage in Originalgröße, gekachelt; vorab eine Übersicht der Blätter. */
function contourPages(ctx: Ctx) {
  const { s, r } = ctx;
  const W = s.format.widthCm;
  const H = s.format.heightCm;
  const t = tileLayout(W, H, s.contour.paper, s.contour.overlapCm);
  const pt = PT_PER_CM;
  const [pwCm, phCm] = t.paper;
  const pageW = pwCm * pt;
  const pageH = phCm * pt;
  const m = t.margin * pt;
  const [prW, prH] = t.printable;
  // Linien in cm, vorab mit Begrenzungsrahmen für die Auswahl je Blatt
  const lines = r.contours.map((l) => {
    const pts = new Float32Array(l.length);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < l.length; i += 2) {
      const x = (l[i] ?? 0) * W;
      const y = (l[i + 1] ?? 0) * H;
      pts[i] = x;
      pts[i + 1] = y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { pts, box: [x0, y0, x1, y1] as const };
  });
  // Übersicht
  {
    const p = ctx.doc.addPage(pageW, pageH);
    ctx.pageNo++;
    p.text('Konturvorlage – Übersicht der Blätter', m, pageH - m - 14, 16, true, INK);
    const lines2 = [
      `Originalgröße ${W.toLocaleString('de-DE')} × ${H.toLocaleString('de-DE')} cm auf ${t.cols * t.rows} Blättern ${s.contour.paper} (${t.landscape ? 'quer' : 'hoch'}), Überlappung ${s.contour.overlapCm.toLocaleString('de-DE')} cm.`,
      'Drucken mit 100 % („Tatsächliche Größe“, nicht „An Seite anpassen“). Das Kontrollmaß auf jedem Blatt muss 5 cm messen.',
      'Blätter an den Passmarken (Kreuze in der Überlappung) übereinanderlegen und zusammenkleben, dann durchpausen.',
    ];
    lines2.forEach((tx, i) => p.text(tx, m, pageH - m - 40 - i * 13, 9, false, INK));
    const availW = pageW - 2 * m;
    const availH = pageH - 2 * m - 110;
    const k = Math.min(availW / W, availH / H);
    const ox = m + (availW - W * k) / 2;
    const oy = m + (availH - H * k) / 2;
    p.stroke(INK, 1).rect(ox, oy, W * k, H * k);
    for (let rr = 0; rr < t.rows; rr++)
      for (let cc = 0; cc < t.cols; cc++) {
        const [tx, ty] = tileOrigin(t, rr, cc);
        const w = Math.min(prW, W - tx);
        const h = Math.min(prH, H - ty);
        p.stroke([0.3, 0.45, 0.85], 0.7).rect(ox + tx * k, oy + (H - ty - h) * k, w * k, h * k);
        p.text(tileName(rr, cc), ox + tx * k + 4, oy + (H - ty) * k - 12, 9, true, [0.3, 0.45, 0.85]);
      }
  }
  const lw = (s.contour.lineWidthMm / 10) * pt;
  for (let rr = 0; rr < t.rows; rr++)
    for (let cc = 0; cc < t.cols; cc++) {
      const [tx, ty] = tileOrigin(t, rr, cc);
      const p = ctx.doc.addPage(pageW, pageH);
      ctx.pageNo++;
      /** Format-cm → Seiten-pt */
      const X = (x: number) => m + (x - tx) * pt;
      const Y = (y: number) => pageH - m - (y - ty) * pt;
      const cw = Math.min(prW, W - tx);
      const ch = Math.min(prH, H - ty);
      p.clip(m, pageH - m - ch * pt, cw * pt, ch * pt);
      p.stroke(INK, lw);
      for (const l of lines) {
        const [x0, y0, x1, y1] = l.box;
        if (x1 < tx || x0 > tx + prW || y1 < ty || y0 > ty + prH) continue;
        const pts = new Float32Array(l.pts.length);
        for (let i = 0; i < pts.length; i += 2) {
          pts[i] = X(l.pts[i] ?? 0);
          pts[i + 1] = Y(l.pts[i + 1] ?? 0);
        }
        p.polyline(pts);
      }
      // Rand des Bildes
      p.stroke(INK, Math.max(lw, 0.8)).rect(X(0), Y(H), W * pt, H * pt);
      p.restore();
      // Passmarken in der Überlappung (gleiche Lage auf beiden Nachbarblättern)
      p.stroke([0.85, 0.2, 0.2], 0.5);
      for (const mx of t.marksX)
        for (const my of [...t.marksY, ty + Math.min(prH, H - ty) / 2]) {
          if (mx < tx || mx > tx + cw || my < ty || my > ty + ch) continue;
          crosshair(p, X(mx), Y(my));
        }
      for (const my of t.marksY)
        for (const mx of [tx + cw / 2]) {
          if (my < ty || my > ty + ch) continue;
          crosshair(p, X(mx), Y(my));
        }
      // Beschriftung und Kontrollmaß 5 cm
      p.text(
        `Konturvorlage · Blatt ${tileName(rr, cc)} (Zeile ${rr + 1} von ${t.rows}, Spalte ${cc + 1} von ${t.cols}) · ${ctx.name}`,
        m,
        m / 2 - 3,
        7,
        false,
        MUTED,
      );
      const barX = pageW - m - 5 * pt;
      const barY = m / 2;
      p.stroke(INK, 0.8).line(barX, barY, barX + 5 * pt, barY);
      p.line(barX, barY - 3, barX, barY + 3).line(barX + 5 * pt, barY - 3, barX + 5 * pt, barY + 3);
      p.text('5 cm', barX + 2.5 * pt - 8, barY + 4, 7, false, INK);
    }
}

function crosshair(p: PdfPage, x: number, y: number) {
  const r = 7;
  p.line(x - r * 1.6, y, x + r * 1.6, y).line(x, y - r * 1.6, x, y + r * 1.6);
  const k = 0.5523 * r;
  p.ops.push(
    `${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S`,
  );
}

/** JPEG eines Canvas (für das Deckblatt). */
async function jpegOf(c: HTMLCanvasElement): Promise<{ data: Uint8Array; width: number; height: number }> {
  const blob = await new Promise<Blob | null>((res) => {
    c.toBlob(res, 'image/jpeg', 0.92);
  });
  if (!blob) throw new Error('JPEG-Kodierung fehlgeschlagen');
  return { data: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
}

/** Baut die Malmappe aus Analyse und Einstellungen; Seiten nach s.pdf.pages. */
export async function buildMalmappe(
  r: MalplanResult,
  d: MalplanDerived,
  s: MalplanSettings,
  name: string,
  x: HelpExtras = {},
): Promise<Uint8Array> {
  const doc = new PdfDocument();
  const ctx: Ctx = { doc, s, r, d, x, name, pageNo: 0 };
  const final = document.createElement('canvas');
  final.width = r.width;
  final.height = r.height;
  final.getContext('2d')?.putImageData(r.image, 0, 0);
  const on = (id: PageId) => s.pdf.pages[id];
  if (on('cover')) cover(ctx, await jpegOf(final));
  if (on('values')) valuesPage(ctx);
  if (on('notan')) notanPage(ctx);
  if (on('warmcold')) warmColdPage(ctx);
  if (on('palette') && x.palette) palettePages(ctx, x.palette);
  if (on('numbers') && x.palette) numbersPage(ctx, x.palette);
  if (on('edges')) edgesPage(ctx);
  if (on('steps')) stepPages(ctx);
  if (on('strokes')) strokesPage(ctx);
  if (on('grid')) gridPage(ctx, final);
  if (on('gridSheet')) gridSheet(ctx);
  if (on('contour')) contourPages(ctx);
  if (ctx.pageNo === 0) throw new Error('Keine Seite ausgewählt.');
  return doc.save({ title: `${name} – Malmappe` });
}
