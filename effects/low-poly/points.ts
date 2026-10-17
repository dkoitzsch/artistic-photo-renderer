// Punktauswahl für Low-Poly – identisch in effect.py (gleicher Zufall mulberry32, gleiche Reihenfolge).
// Punkte in Leinwand-Original-px; Kantenstärke an der Stelle bestimmt die Annahme.

import { mulberry32 } from '../../src/effects/random';

export function lowPolyPoints(
  wc: number,
  hc: number,
  count: number,
  edgeWeight: number,
  seed: number,
  strengthAt: (x: number, y: number) => number,
): number[] {
  const pts: number[] = [0, 0, wc, 0, wc, hc, 0, hc];
  const border = Math.max(2, Math.round(Math.sqrt(count) / 2));
  for (let i = 1; i < border; i++) {
    const t = i / border;
    pts.push(t * wc, 0, t * wc, hc, 0, t * hc, wc, t * hc);
  }
  const rand = mulberry32(seed);
  let accepted = 0;
  for (let tries = 0; tries < count * 30 && accepted < count; tries++) {
    const x = rand() * wc;
    const y = rand() * hc;
    const u = rand();
    const s = strengthAt(x, y);
    if (u < 1 - edgeWeight + edgeWeight * Math.min(1, s * 1.5)) {
      pts.push(x, y);
      accepted++;
    }
  }
  return pts;
}
