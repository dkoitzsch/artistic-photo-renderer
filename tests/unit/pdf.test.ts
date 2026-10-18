import { describe, expect, it } from 'vitest';
import { PAPER_PT, PdfDocument, pdfString, pdfTextString, PT_PER_CM } from '../../src/io/pdf';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** Prüft die Querverweistabelle: jeder Eintrag zeigt auf „n 0 obj“. */
function checkXref(pdf: Uint8Array): number {
  const s = latin1(pdf);
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)?.[1]);
  expect(s.slice(start, start + 4)).toBe('xref');
  const m = /xref\n0 (\d+)\n/.exec(s.slice(start));
  const n = Number(m?.[1]);
  const table = s.slice(start + (m?.[0].length ?? 0));
  for (let i = 1; i < n; i++) {
    const off = Number(table.slice(i * 20, i * 20 + 10));
    expect(s.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
  }
  return n - 1;
}

describe('PDF-Schreiber', () => {
  it('schreibt gültige Querverweise, Seitengrößen und Bilder', () => {
    const doc = new PdfDocument();
    const img = doc.addRgba(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1);
    const [w, h] = PAPER_PT.A4;
    doc.addPage(w, h).image(img, 10, 10, 100, 50).text('Größe: 30 × 40 cm – „gut“', 20, 800, 12, true);
    doc
      .addPage(h, w)
      .stroke([0, 0, 0], 1)
      .rect(0, 0, 10 * PT_PER_CM, 10 * PT_PER_CM);
    const pdf = doc.save({ title: 'Malmappe Test' });
    const s = latin1(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(checkXref(pdf)).toBeGreaterThan(7);
    expect(s).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(s).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(s).toContain('/Count 2');
    expect(s).toContain('/Im1 Do');
    // 10 cm = 283,465 pt
    expect(s).toContain('0 0 283.465 283.465 re S');
  });

  it('kodiert Text in WinAnsi', () => {
    expect(pdfString('Öl (fein)')).toBe('(\\326l \\(fein\\))');
    expect(pdfString('„a“ – €')).toBe('(\\204a\\223 \\226 \\200)');
    expect(pdfString('😀')).toBe('(?)');
    expect(pdfTextString('a–ö')).toBe('<FEFF0061201300F6>');
  });
});
