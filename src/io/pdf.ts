// Kleiner PDF-Schreiber (PDF 1.4) für die Malmappe: Seiten in Punkt (1/72 Zoll), Bilder (JPEG oder RGB mit Flate),
// Vektorpfade, Text in Helvetica (Standardschrift, WinAnsi-Kodierung – deckt Deutsch ab). Inhaltsströme bleiben
// unkomprimiert (klein, prüfbar). Siehe DECISIONS „E2: Grundsatzentscheidungen“.

import { zlibSync } from 'fflate';

export const PT_PER_CM = 72 / 2.54;
export const PAPER_PT: Record<'A4' | 'A3', [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
};

/** WinAnsi-Zeichen außerhalb von Latin-1 */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};

/** Text als PDF-Zeichenkette (WinAnsi, oktal maskiert); unbekannte Zeichen werden „?“. */
export function pdfString(text: string): string {
  let out = '(';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 63;
    let code = WIN_ANSI[ch] ?? (cp < 256 ? cp : 63);
    if (code < 32 && code !== 9) code = 32;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

/** Text für Dokumentinfos (PDF-Textzeichenkette, UTF-16BE mit BOM – dort gilt nicht WinAnsi). */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export type PdfImage = { name: string };

/** Inhalt einer Seite (Koordinaten in pt, Ursprung unten links wie in PDF). */
export class PdfPage {
  readonly ops: string[] = [];
  readonly images = new Set<string>();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Bild in das Rechteck (x, y unten links, w, h) */
  image(img: PdfImage, x: number, y: number, w: number, h: number): this {
    this.images.add(img.name);
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${img.name} Do Q`);
    return this;
  }

  stroke(rgb: [number, number, number] = [0, 0, 0], width = 0.5): this {
    this.ops.push(`${rgb.map((c) => num(c)).join(' ')} RG ${num(width)} w`);
    return this;
  }

  fill(rgb: [number, number, number]): this {
    this.ops.push(`${rgb.map((c) => num(c)).join(' ')} rg`);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number): this {
    this.ops.push(`${num(x0)} ${num(y0)} m ${num(x1)} ${num(y1)} l S`);
    return this;
  }

  /** Polylinie [x0, y0, x1, y1, …] (pt) */
  polyline(pts: ArrayLike<number>): this {
    if (pts.length < 4) return this;
    const parts = [`${num(pts[0] ?? 0)} ${num(pts[1] ?? 0)} m`];
    for (let i = 2; i < pts.length; i += 2) parts.push(`${num(pts[i] ?? 0)} ${num(pts[i + 1] ?? 0)} l`);
    parts.push('S');
    this.ops.push(parts.join(' '));
    return this;
  }

  rect(x: number, y: number, w: number, h: number, mode: 'S' | 'f' | 'B' = 'S'): this {
    this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${mode}`);
    return this;
  }

  /** Folgende Zeichenoperationen auf das Rechteck beschränken (bis restore) */
  clip(x: number, y: number, w: number, h: number): this {
    this.ops.push(`q ${num(x)} ${num(y)} ${num(w)} ${num(h)} re W n`);
    return this;
  }

  save(): this {
    this.ops.push('q');
    return this;
  }

  restore(): this {
    this.ops.push('Q');
    return this;
  }

  text(
    str: string,
    x: number,
    y: number,
    size = 10,
    bold = false,
    rgb: [number, number, number] = [0, 0, 0],
  ): this {
    this.ops.push(
      `BT ${rgb.map((c) => num(c)).join(' ')} rg /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfString(str)} Tj ET`,
    );
    return this;
  }
}

/** Ungefähre Textbreite in Helvetica (pt) – für einfache Ausrichtung. */
export function textWidth(str: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of str) {
    if ("il.,;:|!'’".includes(ch)) w += 0.28;
    else if ('mwMW'.includes(ch)) w += 0.85;
    else if (ch === ' ') w += 0.28;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else w += 0.55;
  }
  return w * size * (bold ? 1.05 : 1);
}

type Obj = { body: Uint8Array | string };

export class PdfDocument {
  private readonly objects: Obj[] = [];
  private readonly pages: PdfPage[] = [];
  private readonly imageObjs = new Map<string, number>();
  private nextImage = 1;

  addPage(width: number, height: number): PdfPage {
    const p = new PdfPage(width, height);
    this.pages.push(p);
    return p;
  }

  /** JPEG-Daten (z. B. aus canvas.toBlob(…, 'image/jpeg')) */
  addJpeg(data: Uint8Array, width: number, height: number): PdfImage {
    const name = `Im${this.nextImage++}`;
    const id = this.push(
      this.stream(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate true`,
        data,
      ),
    );
    this.imageObjs.set(name, id);
    return { name };
  }

  /** RGBA-Pixel (8 Bit), verlustfrei mit Flate; Alpha wird verworfen (auf Weiß) */
  addRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): PdfImage {
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const a = (rgba[i * 4 + 3] ?? 255) / 255;
      rgb[i * 3] = Math.round((rgba[i * 4] ?? 0) * a + 255 * (1 - a));
      rgb[i * 3 + 1] = Math.round((rgba[i * 4 + 1] ?? 0) * a + 255 * (1 - a));
      rgb[i * 3 + 2] = Math.round((rgba[i * 4 + 2] ?? 0) * a + 255 * (1 - a));
    }
    const name = `Im${this.nextImage++}`;
    const id = this.push(
      this.stream(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Interpolate true`,
        zlibSync(rgb, { level: 6 }),
      ),
    );
    this.imageObjs.set(name, id);
    return { name };
  }

  /** Schreibt das Dokument. */
  save(info: { title?: string; author?: string } = {}): Uint8Array {
    // feste Objekte: 1 Katalog, 2 Seitenbaum, 3/4 Schriften, 5 Info; danach Bilder (schon angelegt), Seiten
    const reserved = 5;
    const pageIds: number[] = [];
    const base = reserved + this.objects.length;
    const pageObjs: Obj[] = [];
    this.pages.forEach((p, i) => {
      const contentId = base + i * 2 + 2;
      const pageId = base + i * 2 + 1;
      pageIds.push(pageId);
      const xobj = [...p.images].map((n) => `/${n} ${(this.imageObjs.get(n) ?? 0) + reserved} 0 R`).join(' ');
      pageObjs.push({
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobj} >> >> /Contents ${contentId} 0 R >>`,
      });
      pageObjs.push(this.stream('<<', new TextEncoder().encode(p.ops.join('\n'))));
    });
    const fixed: Obj[] = [
      { body: '<< /Type /Catalog /Pages 2 0 R >>' },
      {
        body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
      },
      { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
      { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>' },
      {
        body: `<< /Producer ${pdfTextString('Blur & Layer Studio')} /Title ${pdfTextString(info.title ?? 'Malmappe')}${info.author ? ` /Author ${pdfTextString(info.author)}` : ''} >>`,
      },
    ];
    const all = [...fixed, ...this.objects, ...pageObjs];
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const write = (b: Uint8Array | string) => {
      const bytes = typeof b === 'string' ? enc.encode(b) : b;
      chunks.push(bytes);
      offset += bytes.length;
    };
    // Kopf mit Binärkennung
    write('%PDF-1.4\n%');
    write(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const offsets: number[] = [];
    all.forEach((o, i) => {
      offsets.push(offset);
      write(`${i + 1} 0 obj\n`);
      write(o.body);
      write('\nendobj\n');
    });
    const xref = offset;
    write(`xref\n0 ${all.length + 1}\n0000000000 65535 f \n`);
    for (const off of offsets) write(`${String(off).padStart(10, '0')} 00000 n \n`);
    write(`trailer\n<< /Size ${all.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(offset);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }

  private push(o: Obj): number {
    this.objects.push(o);
    return this.objects.length; // 1-basiert innerhalb der Bildobjekte
  }

  /** Strom-Objekt: dict ohne schließendes „>>“ (Länge wird ergänzt) */
  private stream(dict: string, data: Uint8Array): Obj {
    const enc = new TextEncoder();
    const head = enc.encode(`${dict} /Length ${data.length} >>\nstream\n`);
    const tail = enc.encode('\nendstream');
    const body = new Uint8Array(head.length + data.length + tail.length);
    body.set(head, 0);
    body.set(data, head.length);
    body.set(tail, head.length + data.length);
    return { body };
  }
}
