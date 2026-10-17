// Presets (Spec „Effekte“ 2.6): eigene Effekt-Presets (benannte Parametersätze mit Vorschaubild) und
// Stapel-Presets (ganze Effekt-Kombination). Reine Funktionen – Speicherung in presets/store.ts.

import { cloneValue, type ParamValue } from '../effects/manifest';
import type { BlendMode, EffectInstance, EffectMask, EffectRegion } from '../state/project';

export type EffectPreset = {
  id: string;
  effectId: string;
  /** Version des Effekts beim Speichern (für spätere Migration) */
  effectVersion: string;
  name: string;
  values: Record<string, ParamValue>;
  /** Vorschaubild als data:-URL (JPEG, ca. 96 px) */
  thumbnail?: string;
  createdAt: string;
};

/** Ein Effekt im Stapel-Preset (ohne Instanz-ID; Masken nur aus Kartenbereichen, da Ebenen projektbezogen sind). */
export type PresetEffect = {
  effectId: string;
  effectVersion: string;
  enabled: boolean;
  strength: number;
  region: EffectRegion;
  params: Record<string, ParamValue>;
  blendMode?: BlendMode;
  mask?: Extract<EffectMask, { kind: 'map' }>;
};

export type StackPreset = {
  id: string;
  name: string;
  effects: PresetEffect[];
  thumbnail?: string;
  createdAt: string;
};

export const PRESET_FILE_FORMAT = 'blur-layer-studio-presets';

export type PresetFile = {
  format: typeof PRESET_FILE_FORMAT;
  version: 1;
  effects: EffectPreset[];
  stacks: StackPreset[];
};

const cloneParams = (p: Record<string, ParamValue>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, cloneValue(v)]));

/** Stapel einer Ebene → Preset-Effekte (Masken anderer Ebenen entfallen, Entkopplung ebenso). */
export function presetEffectsFrom(effects: EffectInstance[]): PresetEffect[] {
  return effects.map((e) => ({
    effectId: e.effectId,
    effectVersion: e.effectVersion,
    enabled: e.enabled,
    strength: e.strength,
    region: e.region,
    params: cloneParams(e.params),
    ...(e.blendMode ? { blendMode: e.blendMode } : {}),
    ...(e.mask?.kind === 'map' ? { mask: { ...e.mask } } : {}),
  }));
}

/** Preset-Effekte → neue Effekt-Instanzen. */
export function instancesFrom(effects: PresetEffect[], newId: () => string): EffectInstance[] {
  return effects.map((e) => ({
    instanceId: newId(),
    effectId: e.effectId,
    effectVersion: e.effectVersion,
    enabled: e.enabled,
    strength: e.strength,
    region: e.region,
    params: cloneParams(e.params),
    ...(e.blendMode ? { blendMode: e.blendMode } : {}),
    ...(e.mask ? { mask: { ...e.mask } } : {}),
  }));
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function checkEffectPreset(v: unknown, i: number): EffectPreset {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.effectId) || !isStr(v.name) || !isObj(v.values))
    throw new Error(`Effekt-Preset ${i + 1} ist unvollständig.`);
  if (
    v.thumbnail !== undefined &&
    !(typeof v.thumbnail === 'string' && v.thumbnail.startsWith('data:image/'))
  )
    throw new Error(`Effekt-Preset „${v.name}“: Vorschaubild ungültig.`);
  return v as EffectPreset;
}

function checkStackPreset(v: unknown, i: number): StackPreset {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !Array.isArray(v.effects))
    throw new Error(`Stapel-Preset ${i + 1} ist unvollständig.`);
  v.effects.forEach((e: unknown, k) => {
    if (!isObj(e) || !isStr(e.effectId) || !isObj(e.params) || typeof e.strength !== 'number')
      throw new Error(`Stapel-Preset „${String(v.name)}“: Effekt ${k + 1} ist unvollständig.`);
    if (e.mask !== undefined && (!isObj(e.mask) || e.mask.kind !== 'map'))
      throw new Error(`Stapel-Preset „${String(v.name)}“: nur Kartenbereiche als Effektmaske erlaubt.`);
  });
  if (
    v.thumbnail !== undefined &&
    !(typeof v.thumbnail === 'string' && v.thumbnail.startsWith('data:image/'))
  )
    throw new Error(`Stapel-Preset „${v.name}“: Vorschaubild ungültig.`);
  return v as StackPreset;
}

/** Prüft eine Preset-Datei (Import). */
export function parsePresetFile(raw: unknown): PresetFile {
  if (!isObj(raw) || raw.format !== PRESET_FILE_FORMAT)
    throw new Error('Keine Preset-Datei von Blur & Layer Studio.');
  if (raw.version !== 1)
    throw new Error(`Preset-Datei Version ${String(raw.version)} wird nicht unterstützt.`);
  if (!Array.isArray(raw.effects) || !Array.isArray(raw.stacks))
    throw new Error('Preset-Datei unvollständig.');
  return {
    format: PRESET_FILE_FORMAT,
    version: 1,
    effects: raw.effects.map(checkEffectPreset),
    stacks: raw.stacks.map(checkStackPreset),
  };
}

/** Führt importierte Presets mit vorhandenen zusammen: gleiche ID wird ersetzt, neue werden angehängt. */
export function mergePresets<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const ids = new Set(incoming.map((x) => x.id));
  return [...existing.filter((x) => !ids.has(x.id)), ...incoming];
}
