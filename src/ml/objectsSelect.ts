// Objekt-Aufteilung (Modus 3): Auswahl der Instanzmasken aus den Kandidaten eines Punktrasters (wie die „automatische
// Maskenerzeugung“ von SAM; gleiche Regeln wie ml-service/src/ml_service/objects.py). Rein und getestet.
//
// Kandidaten: je Punkt drei Masken mit geschätzter IoU. Gütefilter (Score, Stabilität, Fläche), Unterdrückung ähnlicher
// Masken (NMS), große Objekte zuerst, kleinere überschreiben sie → Etikettenkarte ohne Überlappung.

export const OBJ_MIN_SCORE = 0.8;
export const OBJ_MIN_STABILITY = 0.85;
export const OBJ_MIN_AREA = 0.01;
export const OBJ_MAX_AREA = 0.75;
const NMS_IOU = 0.6;
const MIN_VISIBLE = 0.25;

export type ObjectCandidate = { binary: Uint8Array; score: number; area: number };
export type ObjectInfo = { label: number; score: number; area: number };

/**
 * Macht aus Logits (eine Maske, Länge n) einen Kandidaten oder null, wenn Güte, Stabilität oder Fläche nicht reichen.
 * Stabilität: Verhältnis der Fläche bei Schwelle +1 zu der bei −1.
 */
export function candidateFromLogits(
  logits: ArrayLike<number>,
  offset: number,
  n: number,
  score: number,
): ObjectCandidate | null {
  if (score < OBJ_MIN_SCORE) return null;
  let hi = 0;
  let lo = 0;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const v = logits[offset + i] ?? 0;
    if (v > 0) pos++;
    if (v > 1) hi++;
    if (v > -1) lo++;
  }
  const area = pos / n;
  if (area < OBJ_MIN_AREA || area > OBJ_MAX_AREA) return null;
  if (lo === 0 || hi / lo < OBJ_MIN_STABILITY) return null;
  const binary = new Uint8Array(n);
  for (let i = 0; i < n; i++) binary[i] = (logits[offset + i] ?? 0) > 0 ? 1 : 0;
  return { binary, score, area };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x & y) inter++;
    if (x | y) union++;
  }
  return union ? inter / union : 0;
}

/** Wählt höchstens maxObjects Objekte und liefert die Etikettenkarte (0 = kein Objekt, 1…n, große zuerst). */
export function selectObjects(
  candidates: ObjectCandidate[],
  width: number,
  height: number,
  maxObjects: number,
): { labels: Uint16Array; objects: ObjectInfo[] } {
  const n = width * height;
  const ordered = [...candidates].sort((a, b) => b.score * Math.sqrt(b.area) - a.score * Math.sqrt(a.area));
  const kept: ObjectCandidate[] = [];
  for (const c of ordered) {
    if (kept.some((k) => iou(c.binary, k.binary) >= NMS_IOU)) continue;
    kept.push(c);
    if (kept.length >= maxObjects * 2) break;
  }
  const chosen = kept.slice(0, maxObjects).sort((a, b) => b.area - a.area);
  const labels = new Uint16Array(n);
  chosen.forEach((c, i) => {
    for (let p = 0; p < n; p++) if (c.binary[p]) labels[p] = i + 1;
  });
  const counts = new Uint32Array(chosen.length + 1);
  for (let p = 0; p < n; p++) counts[labels[p] ?? 0] = (counts[labels[p] ?? 0] ?? 0) + 1;
  const remap = new Uint16Array(chosen.length + 1);
  const objects: ObjectInfo[] = [];
  chosen.forEach((c, i) => {
    const own = c.binary.reduce((s, v) => s + v, 0);
    const visible = counts[i + 1] ?? 0;
    if (own === 0 || visible / own < MIN_VISIBLE) return;
    const label = objects.length + 1;
    remap[i + 1] = label;
    objects.push({ label, score: Math.round(c.score * 1e4) / 1e4, area: Math.round((visible / n) * 1e5) / 1e5 });
  });
  for (let p = 0; p < n; p++) labels[p] = remap[labels[p] ?? 0] ?? 0;
  return { labels, objects };
}
