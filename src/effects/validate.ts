// Prüft ein Manifest (unbekannte JSON-Daten) gegen den Plugin-Vertrag.
// Liefert alle Fehler auf einmal, damit sie im UI angezeigt werden können.

import { compileExpr, parseCondition } from './expr';
import {
  ANALYSIS_MAPS,
  COSTS,
  EFFECT_INPUTS,
  IMPLEMENTATIONS,
  MAX_PALETTE,
  DEFAULT_TEXT_LENGTH,
  PARAM_TYPES,
  type EffectManifest,
  type ParamSpec,
} from './manifest';

export type ValidationResult = { ok: true; manifest: EffectManifest } | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
/** Zusätzliche Namen in reach-Ausdrücken (Leinwand in px bei voller Auflösung). */
export const REACH_GLOBALS = ['canvasWidth', 'canvasHeight'];
/** Namen, die der Kern im WGSL-Params-Struct selbst belegt. */
export const RESERVED_KEYS = ['resolution', 'origin', 'canvas_size', 'scale', 'flags'];

/** WGSL-Schlüsselwörter und reservierte Wörter (Auswahl, die als Parametername naheliegt) – im Shader nicht erlaubt. */
export const WGSL_RESERVED = new Set(
  (
    'alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if ' +
    'let loop override requires return struct switch true var while ' +
    'NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become binding_array cast ' +
    'catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast ' +
    'consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit ' +
    'export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl ' +
    'implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut ' +
    'mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package ' +
    'packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref ' +
    'regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static ' +
    'static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef ' +
    'typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with ' +
    'writeonly yield'
  ).split(' '),
);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isRgb = (v: unknown) =>
  Array.isArray(v) && v.length === 3 && v.every((c) => isNum(c) && c >= 0 && c <= 1);
const isPoint = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v);

/** Automatisch ergänzter Seed-Parameter für "randomized": true. */
export const AUTO_SEED: ParamSpec = {
  key: 'seed',
  label: 'Seed',
  type: 'seed',
  default: 1,
  group: 'Erweitert',
};

export function validateManifest(raw: unknown, folder?: string): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['manifest.json ist kein JSON-Objekt.'] };

  const { id, name, version, category, inputs, passes, params, presets, reach, visibleIf } = raw;
  const { implementations, license, cost, randomized, requires } = raw;
  if (!isStr(id) || !ID_RE.test(id))
    errors.push('"id" fehlt oder ist nicht in kebab-case (z. B. "echo-offset").');
  else if (folder !== undefined && id !== folder)
    errors.push(`"id" ("${id}") muss dem Ordnernamen ("${folder}") entsprechen.`);
  if (!isStr(name)) errors.push('"name" fehlt.');
  if (!isStr(version) || !SEMVER_RE.test(version)) errors.push('"version" muss die Form "1.0.0" haben.');
  if (!isStr(category)) errors.push('"category" fehlt.');
  if (!Array.isArray(inputs) || !inputs.every((x) => (EFFECT_INPUTS as readonly unknown[]).includes(x)))
    errors.push(`"inputs" muss eine Liste aus ${EFFECT_INPUTS.join(', ')} sein.`);
  if (!Number.isInteger(passes) || (passes as number) < 1)
    errors.push('"passes" muss eine ganze Zahl ≥ 1 sein.');

  const keys = new Map<string, string>();
  if (!Array.isArray(params)) {
    errors.push('"params" muss eine Liste sein.');
  } else {
    params.forEach((p: unknown, i) => {
      const where = `params[${i}]`;
      if (!isObj(p)) {
        errors.push(`${where} ist kein Objekt.`);
        return;
      }
      const { key, label, type, group } = p;
      const at = isStr(key) ? `Parameter "${key}"` : where;
      if (group !== undefined && !isStr(group)) errors.push(`${at}: "group" muss Text sein.`);
      if (!isStr(key) || !KEY_RE.test(key))
        errors.push(`${where}: "key" muss ein Bezeichner sein (Buchstaben, Ziffern, _).`);
      else if (RESERVED_KEYS.includes(key)) errors.push(`${at}: "${key}" ist für den Kern reserviert.`);
      else if (WGSL_RESERVED.has(key)) errors.push(`${at}: "${key}" ist in WGSL ein reserviertes Wort.`);
      else if (keys.has(key)) errors.push(`${at}: "key" ist doppelt.`);
      if (!isStr(label)) errors.push(`${at}: "label" fehlt.`);
      if (!(PARAM_TYPES as readonly unknown[]).includes(type)) {
        errors.push(`${at}: "type" muss einer von ${PARAM_TYPES.join(', ')} sein.`);
        return;
      }
      if (isStr(key)) keys.set(key, type as string);
      const d = p.default;
      switch (type) {
        case 'int':
        case 'float': {
          const { min, max, scale } = p;
          if (!isNum(min) || !isNum(max) || min >= max) errors.push(`${at}: "min" < "max" erforderlich.`);
          else if (!isNum(d) || d < min || d > max)
            errors.push(`${at}: "default" muss zwischen min und max liegen.`);
          if (type === 'int' && isNum(d) && !Number.isInteger(d))
            errors.push(`${at}: "default" muss ganzzahlig sein.`);
          if (scale !== undefined && scale !== 'linear' && scale !== 'log')
            errors.push(`${at}: "scale" muss "linear" oder "log" sein.`);
          if (scale === 'log' && isNum(min) && min < 0)
            errors.push(`${at}: logarithmische Skala braucht min ≥ 0.`);
          break;
        }
        case 'angle':
          if (!isNum(d)) errors.push(`${at}: "default" muss eine Zahl (Grad) sein.`);
          break;
        case 'bool':
          if (typeof d !== 'boolean') errors.push(`${at}: "default" muss true/false sein.`);
          break;
        case 'color':
          if (!isRgb(d)) errors.push(`${at}: "default" muss [r, g, b] mit Werten 0..1 sein.`);
          break;
        case 'point':
          if (!isPoint(d)) errors.push(`${at}: "default" muss [x, y] sein.`);
          break;
        case 'seed':
          if (!isNum(d) || !Number.isInteger(d) || d < 0 || d > 0xffffffff)
            errors.push(`${at}: "default" muss eine ganze Zahl ≥ 0 sein.`);
          break;
        case 'palette':
          if (!Array.isArray(d) || d.length < 1 || d.length > MAX_PALETTE || !d.every(isRgb))
            errors.push(
              `${at}: "default" muss eine Liste von 1–${MAX_PALETTE} Farben [r, g, b] (0..1) sein.`,
            );
          break;
        case 'image':
          if (d !== '') errors.push(`${at}: "default" muss "" sein (kein Bild).`);
          break;
        case 'text': {
          const max = p.maxLength;
          if (max !== undefined && (!isNum(max) || !Number.isInteger(max) || max < 1 || max > 2000))
            errors.push(`${at}: "maxLength" muss eine ganze Zahl von 1 bis 2000 sein.`);
          const limit = isNum(max) ? max : DEFAULT_TEXT_LENGTH;
          if (!isStr(d)) errors.push(`${at}: "default" muss ein Text sein.`);
          else if (Array.from(d).length > limit)
            errors.push(`${at}: "default" ist länger als ${limit} Zeichen.`);
          break;
        }
        case 'enum': {
          const opts = p.options;
          if (
            !Array.isArray(opts) ||
            opts.length === 0 ||
            !opts.every((o) => isObj(o) && isStr(o.value) && isStr(o.label))
          )
            errors.push(`${at}: "options" muss eine Liste von { value, label } sein.`);
          else if (!opts.some((o) => isObj(o) && o.value === d))
            errors.push(`${at}: "default" ist keine der Optionen.`);
          break;
        }
      }
    });
  }

  if (reach !== undefined) {
    if (typeof reach !== 'string') errors.push('"reach" muss ein Ausdruck (Text) sein.');
    else {
      try {
        const unknown = compileExpr(reach).identifiers.filter(
          (n) => !keys.has(n) && !REACH_GLOBALS.includes(n),
        );
        if (unknown.length) errors.push(`"reach" verwendet unbekannte Parameter: ${unknown.join(', ')}.`);
      } catch (e) {
        errors.push(`"reach": ${(e as Error).message}`);
      }
    }
  }

  if (visibleIf !== undefined) {
    if (!isObj(visibleIf)) errors.push('"visibleIf" muss ein Objekt { param: Bedingung } sein.');
    else
      for (const [k, cond] of Object.entries(visibleIf)) {
        if (!keys.has(k)) errors.push(`"visibleIf": unbekannter Parameter "${k}".`);
        try {
          if (typeof cond !== 'string') throw new Error('Bedingung muss Text sein');
          const c = parseCondition(cond);
          if (!keys.has(c.key)) errors.push(`"visibleIf.${k}": unbekannter Parameter "${c.key}".`);
        } catch (e) {
          errors.push(`"visibleIf.${k}": ${(e as Error).message}`);
        }
      }
  }

  if (presets !== undefined) {
    if (!Array.isArray(presets)) errors.push('"presets" muss eine Liste sein.');
    else
      presets.forEach((pr: unknown, i) => {
        if (!isObj(pr) || !isStr(pr.name) || !isObj(pr.values)) {
          errors.push(`presets[${i}] braucht "name" und "values".`);
          return;
        }
        for (const k of Object.keys(pr.values))
          if (!keys.has(k)) errors.push(`Preset "${pr.name}": unbekannter Parameter "${k}".`);
      });
  }

  // ---- Manifest v2 ----
  let impl = { preview: 'webgpu', final: 'webgpu' } as EffectManifest['implementations'];
  if (implementations !== undefined) {
    if (!isObj(implementations) || !oneOf(IMPLEMENTATIONS, implementations.final))
      errors.push(`"implementations.final" muss einer von ${IMPLEMENTATIONS.join(', ')} sein.`);
    else if (implementations.preview !== undefined && !oneOf(IMPLEMENTATIONS, implementations.preview))
      errors.push(`"implementations.preview" muss einer von ${IMPLEMENTATIONS.join(', ')} sein.`);
    else
      impl = {
        final: implementations.final,
        preview: oneOf(IMPLEMENTATIONS, implementations.preview)
          ? implementations.preview
          : implementations.final,
      };
  }
  let lic: EffectManifest['license'] = { commercialUse: true };
  if (license !== undefined) {
    if (!isObj(license) || typeof license.commercialUse !== 'boolean')
      errors.push('"license" muss { "commercialUse": true|false, "notes"?: "…" } sein.');
    else if (license.notes !== undefined && typeof license.notes !== 'string')
      errors.push('"license.notes" muss Text sein.');
    else
      lic = {
        commercialUse: license.commercialUse,
        ...(isStr(license.notes) ? { notes: license.notes } : {}),
      };
  }
  if (cost !== undefined && !oneOf(COSTS, cost))
    errors.push(`"cost" muss einer von ${COSTS.join(', ')} sein.`);
  if (randomized !== undefined && typeof randomized !== 'boolean')
    errors.push('"randomized" muss true/false sein.');
  if (requires !== undefined && (!Array.isArray(requires) || !requires.every((m) => oneOf(ANALYSIS_MAPS, m))))
    errors.push(`"requires" muss eine Liste aus ${ANALYSIS_MAPS.join(', ')} sein.`);
  if (Array.isArray(params) && params.filter((p) => isObj(p) && p.type === 'image').length > 1)
    errors.push('Höchstens ein Parameter vom Typ "image" (Zweitbild in src_b).');

  if (errors.length) return { ok: false, errors };

  // Normalisieren: Standardwerte ergänzen, Seed-Parameter bei "randomized" anfügen
  const manifest = raw as unknown as EffectManifest;
  const paramList = [...manifest.params];
  if (randomized === true && !paramList.some((p) => p.type === 'seed')) {
    if (keys.has('seed'))
      return { ok: false, errors: ['"randomized": Parameter "seed" muss vom Typ "seed" sein.'] };
    paramList.push(AUTO_SEED);
  }
  return {
    ok: true,
    manifest: {
      ...manifest,
      params: paramList,
      implementations: impl,
      license: lic,
      cost: oneOf(COSTS, cost) ? cost : 'realtime',
      randomized: randomized === true,
      requires: Array.isArray(requires) ? (requires as EffectManifest['requires']) : [],
    },
  };
}
