// Typen des Effekt-Manifests (effects/<id>/manifest.json). Vertrag: SPEC Abschnitt „Effekt-Plugin-System“.

export const EFFECT_INPUTS = ['source', 'mask', 'focus', 'depth'] as const;
export type EffectInput = (typeof EFFECT_INPUTS)[number];

export const PARAM_TYPES = ['int', 'float', 'angle', 'bool', 'color', 'enum', 'point'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export type Rgb = [number, number, number];
export type ParamValue = number | string | boolean | Rgb | [number, number];

type ParamBase = { key: string; label: string; hint?: string };

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

export type ParamSpec = NumberParam | AngleParam | BoolParam | ColorParam | EnumParam | PointParam;

export type Preset = { name: string; values: Record<string, ParamValue> };

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
};

export function defaultParams(manifest: EffectManifest): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of manifest.params) {
    out[p.key] = Array.isArray(p.default) ? ([...p.default] as Rgb | [number, number]) : p.default;
  }
  return out;
}
