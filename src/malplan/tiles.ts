// Kachelung der Konturvorlage in Originalgröße auf Druckblätter (Spec 7.7): Überlappung, Passmarken, Ausrichtung.
// Reine Rechnung in cm, getestet in tests/unit/malplan.test.ts.

export type TileLayout = {
  /** Blatt in cm (Breite, Höhe) in der gewählten Ausrichtung */
  paper: [number, number];
  landscape: boolean;
  /** bedruckbarer Bereich je Blatt in cm */
  printable: [number, number];
  margin: number;
  overlap: number;
  cols: number;
  rows: number;
  /** Schrittweite zwischen Blättern in cm (bedruckbar − Überlappung) */
  step: [number, number];
  /** Passmarken je Achse (Lage in cm im Format, von beiden Nachbarblättern gedruckt) */
  marksX: number[];
  marksY: number[];
};

const PAPER_CM = { A4: [21, 29.7], A3: [29.7, 42] } as const;

function layout(
  W: number,
  H: number,
  paper: [number, number],
  landscape: boolean,
  margin: number,
  overlap: number,
): TileLayout {
  const pw = paper[0] - 2 * margin;
  const ph = paper[1] - 2 * margin;
  const sx = Math.max(0.5, pw - overlap);
  const sy = Math.max(0.5, ph - overlap);
  const cols = W <= pw ? 1 : Math.ceil((W - overlap) / sx - 1e-9);
  const rows = H <= ph ? 1 : Math.ceil((H - overlap) / sy - 1e-9);
  const marks = (n: number, step: number, size: number) => {
    const out: number[] = [];
    for (let i = 1; i < n; i++) out.push(i * step + overlap / 2);
    // nur innerhalb des Formats
    return out.filter((v) => v > 0 && v < size);
  };
  return {
    paper,
    landscape,
    printable: [pw, ph],
    margin,
    overlap,
    cols,
    rows,
    step: [sx, sy],
    marksX: marks(cols, sx, W),
    marksY: marks(rows, sy, H),
  };
}

/** Wählt die Blattausrichtung mit den wenigsten Blättern (bei Gleichstand Hochformat). */
export function tileLayout(
  W: number,
  H: number,
  paper: 'A4' | 'A3',
  overlap: number,
  margin = 1,
): TileLayout {
  const [a, b] = PAPER_CM[paper];
  const portrait = layout(W, H, [a, b], false, margin, overlap);
  const land = layout(W, H, [b, a], true, margin, overlap);
  return land.cols * land.rows < portrait.cols * portrait.rows ? land : portrait;
}

/** Ursprung (cm im Format) des Blattes in Zeile r, Spalte c. */
export function tileOrigin(t: TileLayout, r: number, c: number): [number, number] {
  return [c * t.step[0], r * t.step[1]];
}

/** Bezeichnung eines Blattes: Spalte als Buchstabe, Zeile als Zahl (A1 oben links). */
export function tileName(r: number, c: number): string {
  return `${String.fromCharCode(65 + (c % 26))}${r + 1}`;
}
