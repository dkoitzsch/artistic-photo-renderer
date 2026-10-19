// Typen des Effekt-Manifests (effects/<id>/manifest.json). Vertrag: SPEC Abschnitt „Effekt-Plugin-System“.

export const EFFECT_INPUTS = ['source', 'mask', 'focus', 'depth'] as const;
export type EffectInput = (typeof EFFECT_INPUTS)[number];

export const PARAM_TYPES = [
  'int',
  'float',
  'angle',
  'bool',
  'color',
  'enum',
  'point',
  'seed',
  'palette',
  'image',
  'text',
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** Analysekarten (Spec „Effekte“, Abschnitt 4); Effekte fordern sie über "requires" an. */
export const ANALYSIS_MAPS = [
  'luminance',
  'edges',
  'flow',
  'depth',
  'normals',
  'segmentation',
  'saliency',
  'faces',
] as const;
export type AnalysisMapId = (typeof ANALYSIS_MAPS)[number];

/** Ausführungsorte: GPU im Browser, CPU im Browser (Web Worker), Python-Dienst. */
export const IMPLEMENTATIONS = ['webgpu', 'browser-cpu', 'python'] as const;
export type Implementation = (typeof IMPLEMENTATIONS)[number];

export const COSTS = ['realtime', 'interactive', 'slow', 'very-slow'] as const;
export type Cost = (typeof COSTS)[number];

/** Höchstzahl Farben eines Paletten-Parameters (Größe des Uniform-Arrays). */
export const MAX_PALETTE = 16;

export type Rgb = [number, number, number];
export type ParamValue = number | string | boolean | Rgb | [number, number] | Rgb[];

type ParamBase = {
  key: string;
  label: string;
  hint?: string;
  /** UI-Gruppe, z. B. "Erweitert" (eingeklappt) */
  group?: string;
};

export type NumberParam = ParamBase & {
  type: 'int' | 'float';
  min: number;
  max: number;
  default: number;
  step?: number;
  /** "px": wird vom Kern mit dem Skalierungsfaktor (Vorschau/Export) umgerechnet. "%" nur Anzeige. */
  unit?: string;
  scale?: 'linear' | 'log';
};
/** Winkel in Grad im UI/Projekt; im Shader als Radiant. */
export type AngleParam = ParamBase & { type: 'angle'; default: number };
export type BoolParam = ParamBase & { type: 'bool'; default: boolean };
/** Farbe sRGB-kodiert 0..1 im UI/Projekt; im Shader linear. */
export type ColorParam = ParamBase & { type: 'color'; default: Rgb };
export type EnumParam = ParamBase & {
  type: 'enum';
  options: { value: string; label: string }[];
  default: string;
};
/** Position auf der Leinwand in Pixeln (volle Auflösung); im Shader skaliert. */
export type PointParam = ParamBase & { type: 'point'; default: [number, number] };

/** Startwert des Zufalls (ganzzahlig ≥ 0); gleicher Seed + gleiche Parameter = gleiches Ergebnis. Im Shader u32. */
export type SeedParam = ParamBase & { type: 'seed'; default: number };
/** Farbpalette (sRGB 0..1), 1 bis MAX_PALETTE Farben; im Shader array<vec4f, 16> (linear) + <key>_count. */
export type PaletteParam = ParamBase & { type: 'palette'; default: Rgb[] };
/** Zweitbild: ID eines Originals im Projekt ("" = keins); im Shader u32 (1 = vorhanden), Textur = src_b. */
export type ImageParam = ParamBase & {
  type: 'image';
  default: '';
  /** Hinweis, der beim Laden eines Bildes erscheint (z. B. Lizenz von Stilbildern) */
  notice?: string;
};
/** Freier Text (z. B. für ASCII-Kunst); im Shader u32 = Anzahl Zeichen, der Text selbst über ctx.raw in effect.ts. */
export type TextParam = ParamBase & { type: 'text'; default: string; maxLength?: number };

/** Höchstlänge eines Text-Parameters ohne eigene Angabe. */
export const DEFAULT_TEXT_LENGTH = 200;

export type ParamSpec =
  | NumberParam
  | AngleParam
  | BoolParam
  | ColorParam
  | EnumParam
  | PointParam
  | SeedParam
  | PaletteParam
  | ImageParam
  | TextParam;

export type Preset = { name: string; values: Record<string, ParamValue> };

/** Herkunft/Lizenz eines Effekts (Verfahren, Modelle, Daten) für den Lizenzmodus. */
export type EffectLicense = { commercialUse: boolean; notes?: string };

export type EffectManifest = {
  id: string;
  name: string;
  version: string;
  category: string;
  description?: string;
  inputs: EffectInput[];
  passes: number;
  params: ParamSpec[];
  presets?: Preset[];
  /** Reichweite in px (volle Auflösung) als Ausdruck über Parameter, z. B. "radius". Für Export-Kacheln. */
  reach?: string;
  /** Parameter, die nur sichtbar sind, wenn eine Bedingung gilt: { "shadowColor": "duotone" } */
  visibleIf?: Record<string, string>;
  // ---- Manifest v2 (Effekt-Erweiterung); fehlende Angaben ergänzt die Prüfung mit Standardwerten ----
  /** Ausführungsort der Vorschau und des Endrenders (Standard: beide webgpu) */
  implementations: { preview: Implementation; final: Implementation };
  license: EffectLicense;
  cost: Cost;
  /** true: Seed-Parameter "seed" wird automatisch ergänzt, falls er fehlt */
  randomized: boolean;
  /** benötigte Analysekarten */
  requires: AnalysisMapId[];
};

export function defaultParams(manifest: EffectManifest): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of manifest.params) out[p.key] = cloneValue(p.default);
  return out;
}

/** Tiefe Kopie eines Parameterwerts (Arrays, Paletten). */
export function cloneValue(v: ParamValue): ParamValue {
  if (!Array.isArray(v)) return v;
  return v.map((x) => (Array.isArray(x) ? [...x] : x)) as ParamValue;
}

/** true, wenn ein Teil des Effekts außerhalb der GPU-Kette läuft (asynchron: Worker oder Dienst). */
export function isAsyncEffect(manifest: EffectManifest): boolean {
  return manifest.implementations.preview !== 'webgpu' || manifest.implementations.final !== 'webgpu';
}
