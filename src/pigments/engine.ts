// Pigment-Engine (Spec „Effekte“ 6): subtraktive Farbmischung nach Kubelka-Munk mit zwei Konstanten (K, S je
// Wellenlänge) und Rezeptsuche. Spektren und Konstanten werden aus den Näherungsfarben der Datenbank abgeleitet
// (DECISIONS.md „E4“): Vollton → K/S des Pigments; Aufhellung 1:4 mit Titanweiß (S_Weiß = 1) → S des Pigments.
// Rein, ohne Browser-APIs (läuft auch im Worker und in Unit-Tests).

import db from './pigments.json';
import {
  BANDS,
  decodeSrgb,
  deltaE2000,
  encodeSrgb,
  hexToSrgb,
  reflectanceFromSrgb,
  spectrumToLinear,
  srgbToHex,
  srgbToLab,
  linearToXyz,
  xyzToLab,
} from './spectral';

export type PigmentInfo = {
  id: string;
  name: string;
  /** Colour-Index-Bezeichnung, z. B. PB29 */
  ci: string;
  masstone: string;
  tint: string;
  /** 0 = lasierend … 1 = deckend */
  opacity: number;
  lightfastness: 'I' | 'II' | 'III';
  /** Neigung zur Granulation (Aquarell) 0…1 */
  granulation: number;
  white?: boolean;
};

export const PIGMENTS: readonly PigmentInfo[] = db.pigments as PigmentInfo[];
const TINT_RATIO = db.tintRatio;

export function pigmentById(id: string): PigmentInfo | undefined {
  return PIGMENTS.find((p) => p.id === id);
}

/** K/S aus Reflexion (Kubelka-Munk, unendlich dicke Schicht) */
const ksOf = (r: number) => {
  const R = Math.min(0.9999, Math.max(1e-4, r));
  return ((1 - R) * (1 - R)) / (2 * R);
};
/** Reflexion aus K/S */
const rOf = (ks: number) => 1 + ks - Math.sqrt(ks * ks + 2 * ks);

type Constants = { K: Float64Array; S: Float64Array };
const cache = new Map<string, Constants>();

const WHITE_ID = 'titanium-white';

/** K und S eines Pigments je Wellenlänge (gecacht). */
export function constantsOf(id: string): Constants {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = pigmentById(id);
  if (!p) throw new Error(`Pigment ${id} unbekannt.`);
  const Rm = reflectanceFromSrgb(hexToSrgb(p.masstone));
  const K = new Float64Array(BANDS);
  const S = new Float64Array(BANDS);
  if (p.white) {
    // Weiß: Streuung 1 (Bezug), Absorption aus dem Vollton
    for (let i = 0; i < BANDS; i++) {
      S[i] = 1;
      K[i] = ksOf(Rm[i] ?? 0.9);
    }
  } else {
    const white = constantsOf(WHITE_ID);
    const Rt = reflectanceFromSrgb(hexToSrgb(p.tint));
    const c = TINT_RATIO;
    for (let i = 0; i < BANDS; i++) {
      const a = ksOf(Rm[i] ?? 0);
      const b = ksOf(Rt[i] ?? 0);
      const Kw = white.K[i] ?? 0;
      const Sw = white.S[i] ?? 1;
      // (a·Sp·c + Kw(1−c)) / (Sp·c + Sw(1−c)) = b  →  Sp
      let Sp = a - b > 1e-6 ? ((1 - c) * (b * Sw - Kw)) / (c * (a - b)) : 50;
      Sp = Math.min(50, Math.max(1e-3, Sp));
      S[i] = Sp;
      K[i] = a * Sp;
    }
  }
  const out = { K, S };
  cache.set(id, out);
  return out;
}

export type MixPart = { id: string; parts: number };

export type MixResult = {
  /** sRGB 0…1 */
  srgb: [number, number, number];
  hex: string;
  /** CIELAB (D65) */
  lab: [number, number, number];
  /** Reflexionsspektrum (31 Werte, 400–700 nm) */
  spectrum: Float64Array;
};

/** Mischt Pigmente in Teilen (Volumenanteile). */
export function mix(parts: readonly MixPart[]): MixResult {
  const total = parts.reduce((s, p) => s + Math.max(0, p.parts), 0);
  if (total <= 0) throw new Error('Mischung ohne Anteile.');
  const K = new Float64Array(BANDS);
  const S = new Float64Array(BANDS);
  for (const p of parts) {
    const c = Math.max(0, p.parts) / total;
    if (c === 0) continue;
    const k = constantsOf(p.id);
    for (let i = 0; i < BANDS; i++) {
      K[i] = (K[i] ?? 0) + c * (k.K[i] ?? 0);
      S[i] = (S[i] ?? 0) + c * (k.S[i] ?? 0);
    }
  }
  const spectrum = new Float64Array(BANDS);
  for (let i = 0; i < BANDS; i++) spectrum[i] = rOf((K[i] ?? 0) / Math.max(1e-9, S[i] ?? 0));
  const lin = spectrumToLinear(spectrum);
  const srgb = lin.map((v) => Math.min(1, Math.max(0, encodeSrgb(v)))) as [number, number, number];
  return { srgb, hex: srgbToHex(srgb), lab: xyzToLab(linearToXyz(lin.map((v) => Math.max(0, v)))), spectrum };
}

export type Recipe = {
  /** Anteile 0…1 (Summe 1), größter zuerst */
  parts: { id: string; fraction: number }[];
  result: MixResult;
  /** ΔE2000 zur Zielfarbe */
  deltaE: number;
};

function labOfFractions(ids: readonly string[], fr: readonly number[]): [number, number, number] {
  return mix(ids.map((id, i) => ({ id, parts: fr[i] ?? 0 }))).lab;
}

function combinations<T>(list: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  list.forEach((x, i) => {
    for (const rest of combinations(list.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}

/** Mengengitter für Mischungen aus n Pigmenten (Anteile > 0, Summe 1), dichter bei kleinen Anteilen. */
function fractionGrid(n: number): number[][] {
  if (n === 1) return [[1]];
  const steps = [
    0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.96, 0.98, 0.99,
  ];
  if (n === 2) return steps.map((t) => [t, 1 - t]);
  const out: number[][] = [];
  const s3 = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85];
  for (const a of s3)
    for (const b of s3) {
      const c = 1 - a - b;
      if (c > 0.005) out.push([a, b, c]);
    }
  return out;
}

/** Verfeinert Anteile (Koordinatensuche in log-Teilen). */
function refine(
  ids: readonly string[],
  fr: number[],
  target: readonly number[],
): { fr: number[]; dE: number } {
  let logs = fr.map((f) => Math.log(Math.max(1e-4, f)));
  const evalLogs = (l: number[]) => {
    const e = l.map(Math.exp);
    const s = e.reduce((a, b) => a + b, 0);
    const f = e.map((v) => v / s);
    return { f, dE: deltaE2000(labOfFractions(ids, f), target) };
  };
  let best = evalLogs(logs);
  let step = 0.6;
  for (let it = 0; it < 40 && step > 0.01; it++) {
    let improved = false;
    for (let i = 0; i < logs.length; i++)
      for (const d of [step, -step]) {
        const cand = logs.slice();
        cand[i] = (cand[i] ?? 0) + d;
        const r = evalLogs(cand);
        if (r.dE < best.dE - 1e-6) {
          best = r;
          logs = cand;
          improved = true;
        }
      }
    if (!improved) step /= 2;
  }
  return { fr: best.f, dE: best.dE };
}

/**
 * Sucht ein Mischrezept für eine Zielfarbe (sRGB 0…1) aus den verfügbaren Pigmenten (höchstens maxPigments, Weiß
 * zählt mit). Liefert immer ein Rezept; liegt der Ton außerhalb des Mischbaren, zeigt deltaE die Abweichung.
 */
export function findMix(target: readonly number[], available: readonly string[], maxPigments = 3): Recipe {
  const ids = [...new Set(available)].filter((id) => pigmentById(id));
  if (!ids.length) throw new Error('Keine Pigmente ausgewählt.');
  const tLab = srgbToLab(target);
  type Cand = { ids: string[]; fr: number[]; dE: number };
  const cands: Cand[] = [];
  for (let k = 1; k <= Math.min(maxPigments, ids.length); k++)
    for (const combo of combinations(ids, k))
      for (const fr of fractionGrid(k))
        cands.push({ ids: combo, fr, dE: deltaE2000(labOfFractions(combo, fr), tLab) });
  cands.sort((a, b) => a.dE - b.dE);
  // die besten (verschiedenen Kombinationen) verfeinern
  const seen = new Set<string>();
  let best: Cand | null = null;
  for (const c of cands) {
    const key = c.ids.join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = c.ids.length > 1 ? refine(c.ids, c.fr, tLab) : { fr: c.fr, dE: c.dE };
    // einfachere Rezepte bevorzugen: je weiteres Pigment zählt wie 0,4 ΔE
    const score = (x: Cand) => x.dE + 0.4 * (x.ids.length - 1);
    const cand = { ids: c.ids, fr: r.fr, dE: r.dE };
    if (!best || score(cand) < score(best)) best = cand;
    if (seen.size >= 8) break;
  }
  if (!best) throw new Error('Keine Mischung gefunden.');
  // vernachlässigbare Anteile (< 0,5 %) weglassen
  const parts = best.ids
    .map((id, i) => ({ id, fraction: best.fr[i] ?? 0 }))
    .filter((p) => p.fraction >= 0.005)
    .sort((a, b) => b.fraction - a.fraction);
  const s = parts.reduce((a, p) => a + p.fraction, 0);
  for (const p of parts) p.fraction /= s;
  const result = mix(parts.map((p) => ({ id: p.id, parts: p.fraction })));
  return { parts, result, deltaE: deltaE2000(result.lab, tLab) };
}

/**
 * Rezept in Teilen, z. B. „2 Teile Ultramarinblau + 1 Teil Siena gebrannt + etwas Titanweiß“: Anteile unter 10 % heißen
 * „etwas“, die übrigen werden auf kleine ganze Teile (höchstens 6) gerundet.
 */
export function recipeParts(r: Recipe): { id: string; name: string; parts: number | null }[] {
  const major = r.parts.filter((p) => p.fraction >= 0.1);
  const smallest = Math.min(...major.map((p) => p.fraction));
  let scale = 1 / smallest;
  // auf höchstens 6 Teile für den größten Anteil begrenzen
  const largest = Math.max(...major.map((p) => p.fraction));
  if (largest * scale > 6) scale = 6 / largest;
  return r.parts.map((p) => ({
    id: p.id,
    name: pigmentById(p.id)?.name ?? p.id,
    parts: p.fraction >= 0.1 ? Math.max(1, Math.round(p.fraction * scale)) : null,
  }));
}

export function formatRecipe(r: Recipe): string {
  return recipeParts(r)
    .map((p) =>
      p.parts === null ? `etwas ${p.name}` : `${p.parts} ${p.parts === 1 ? 'Teil' : 'Teile'} ${p.name}`,
    )
    .join(' + ');
}

/** Lineares sRGB einer Mischung (für Bildberechnungen) */
export const mixLinear = (parts: readonly MixPart[]): [number, number, number] =>
  mix(parts).srgb.map(decodeSrgb) as [number, number, number];
