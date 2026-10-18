// Erzeugt aus dem Manifest das WGSL-Struct "Params" und packt Parameterwerte passend dazu
// (WGSL-Ausrichtung: f32/i32/u32 4 Byte, vec2f 8, vec3f 16 bei 12 Byte Größe; Struct auf 16 gerundet).

import { srgbToLinear } from '../render/color';
import { MAX_PALETTE, type EffectManifest, type ParamSpec, type ParamValue, type Rgb } from './manifest';

type FieldKind = 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec3f' | 'palette';
export type Field = { name: string; kind: FieldKind; offset: number };
export type UniformLayout = { fields: Field[]; size: number; struct: string };

const SIZE: Record<FieldKind, number> = {
  f32: 4,
  i32: 4,
  u32: 4,
  vec2f: 8,
  vec3f: 12,
  palette: 16 * MAX_PALETTE,
};
const ALIGN: Record<FieldKind, number> = { f32: 4, i32: 4, u32: 4, vec2f: 8, vec3f: 16, palette: 16 };
const WGSL_TYPE: Record<FieldKind, string> = {
  f32: 'f32',
  i32: 'i32',
  u32: 'u32',
  vec2f: 'vec2f',
  vec3f: 'vec3f',
  palette: `array<vec4f, ${MAX_PALETTE}>`,
};

/** Vom Kern belegte Felder am Anfang jedes Params-Structs. */
const CORE_FIELDS: { name: string; kind: FieldKind; doc: string }[] = [
  { name: 'resolution', kind: 'vec2f', doc: 'Größe der Ausgabe in px' },
  { name: 'origin', kind: 'vec2f', doc: 'Lage der Ausgabe auf der Leinwand in px (bei aktuellem scale)' },
  { name: 'canvas_size', kind: 'vec2f', doc: 'Leinwandgröße in px (bei aktuellem scale)' },
  { name: 'scale', kind: 'f32', doc: 'Pixel-Skalierung: Vorschau < 1, Export = 1' },
  { name: 'flags', kind: 'u32', doc: 'Bit 0: Fokuskarte vorhanden' },
];

function kindOf(p: ParamSpec): FieldKind {
  switch (p.type) {
    case 'int':
      return 'i32';
    case 'float':
    case 'angle':
      return 'f32';
    case 'bool':
    case 'enum':
    case 'seed':
    case 'image':
    case 'text':
      return 'u32';
    case 'color':
      return 'vec3f';
    case 'point':
      return 'vec2f';
    case 'palette':
      return 'palette';
  }
}

const roundUp = (n: number, a: number) => Math.ceil(n / a) * a;

export function buildLayout(manifest: EffectManifest): UniformLayout {
  const fields: Field[] = [];
  let offset = 0;
  const lines: string[] = [];
  const add = (name: string, kind: FieldKind, doc: string) => {
    offset = roundUp(offset, ALIGN[kind]);
    fields.push({ name, kind, offset });
    lines.push(`  ${name}: ${WGSL_TYPE[kind]}, // ${doc}`);
    offset += SIZE[kind];
  };
  for (const f of CORE_FIELDS) add(f.name, f.kind, f.doc);
  for (const p of manifest.params) {
    add(p.key, kindOf(p), describe(p));
    if (p.type === 'palette') add(`${p.key}_count`, 'u32', `Anzahl Farben in ${p.key}`);
  }
  const size = roundUp(Math.max(offset, 16), 16);
  return { fields, size, struct: `struct Params {\n${lines.join('\n')}\n}` };
}

function describe(p: ParamSpec): string {
  switch (p.type) {
    case 'angle':
      return `${p.label} (Radiant)`;
    case 'color':
      return `${p.label} (linear RGB)`;
    case 'enum':
      return `${p.label}: ${p.options.map((o, i) => `${i}=${o.value}`).join(', ')}`;
    case 'bool':
      return `${p.label} (0/1)`;
    case 'point':
      return `${p.label} (px, skaliert)`;
    case 'seed':
      return `${p.label} (Seed)`;
    case 'palette':
      return `${p.label} (linear RGB, max. ${MAX_PALETTE})`;
    case 'image':
      return `${p.label} (1 = Zweitbild in src_b)`;
    case 'text':
      return `${p.label} (Anzahl Zeichen; Text über ctx.raw)`;
    case 'int':
    case 'float':
      return p.unit === 'px' ? `${p.label} (px, skaliert)` : p.label;
  }
}

/** Palette aus einem Projektwert (ungültig → Standard), höchstens MAX_PALETTE Farben. */
export function paletteOf(v: ParamValue | undefined, fallback: Rgb[]): Rgb[] {
  const list = Array.isArray(v) && v.length > 0 && v.every((c) => Array.isArray(c)) ? v : fallback;
  return list.slice(0, MAX_PALETTE);
}

export type CoreValues = {
  resolution: [number, number];
  origin: [number, number];
  canvasSize: [number, number];
  scale: number;
  /** Bit 0: Fokuskarte vorhanden */
  flags?: number;
};

/** Wandelt einen Projektwert in den Shaderwert um (px skaliert, Grad→Radiant, sRGB→linear, enum→Index). */
export function shaderValue(p: ParamSpec, raw: ParamValue | undefined, scale: number): number | number[] {
  const v = raw ?? p.default;
  switch (p.type) {
    case 'seed':
      return Math.max(0, Math.floor(Number(v))) >>> 0;
    case 'image':
      return typeof v === 'string' && v !== '' ? 1 : 0;
    case 'text':
      return typeof v === 'string' ? Array.from(v).length : 0;
    case 'palette':
      return paletteOf(v, p.default).flatMap((c) => [...c.map((x) => srgbToLinear(x)), 1]);
    case 'int':
      return Math.round(Number(v) * (p.unit === 'px' ? scale : 1));
    case 'float':
      return Number(v) * (p.unit === 'px' ? scale : 1);
    case 'angle':
      return (Number(v) * Math.PI) / 180;
    case 'bool':
      return v === true ? 1 : 0;
    case 'enum':
      return Math.max(
        0,
        p.options.findIndex((o) => o.value === v),
      );
    case 'color': {
      const c = Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? v : p.default;
      return c.map((x) => srgbToLinear(x));
    }
    case 'point': {
      const c = Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? v : p.default;
      return [c[0] * scale, c[1] * scale];
    }
  }
}

export function packUniforms(
  manifest: EffectManifest,
  layout: UniformLayout,
  params: Record<string, ParamValue>,
  core: CoreValues,
): ArrayBuffer {
  const buf = new ArrayBuffer(layout.size);
  const dv = new DataView(buf);
  const write = (field: Field, value: number | number[]) => {
    const vals = typeof value === 'number' ? [value] : value;
    vals.forEach((x, i) => {
      const off = field.offset + i * 4;
      if (field.kind === 'i32') dv.setInt32(off, x, true);
      else if (field.kind === 'u32') dv.setUint32(off, x, true);
      else dv.setFloat32(off, x, true);
    });
  };
  const byName = new Map(layout.fields.map((f) => [f.name, f]));
  const f = (n: string) => {
    const field = byName.get(n);
    if (!field) throw new Error(`Feld ${n} fehlt`);
    return field;
  };
  write(f('resolution'), core.resolution);
  write(f('origin'), core.origin);
  write(f('canvas_size'), core.canvasSize);
  write(f('scale'), core.scale);
  write(f('flags'), core.flags ?? 0);
  for (const p of manifest.params) {
    write(f(p.key), shaderValue(p, params[p.key], core.scale));
    if (p.type === 'palette') write(f(`${p.key}_count`), paletteOf(params[p.key], p.default).length);
  }
  return buf;
}
