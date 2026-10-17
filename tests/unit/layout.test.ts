import { describe, expect, it } from 'vitest';
import { buildLayout, packUniforms, shaderValue } from '../../src/effects/layout';
import type { EffectManifest } from '../../src/effects/manifest';
import { srgbToLinear } from '../../src/render/color';

const manifest: EffectManifest = {
  id: 't',
  name: 'T',
  version: '1.0.0',
  category: 'x',
  inputs: ['source'],
  passes: 1,
  params: [
    { key: 'radius', label: 'R', type: 'float', min: 0, max: 300, default: 20, unit: 'px' },
    { key: 'tint', label: 'F', type: 'color', default: [1, 0.5, 0] },
    { key: 'on', label: 'B', type: 'bool', default: true },
    { key: 'pos', label: 'P', type: 'point', default: [100, 50] },
    {
      key: 'mode',
      label: 'M',
      type: 'enum',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      default: 'b',
    },
    { key: 'angle', label: 'W', type: 'angle', default: 180 },
    { key: 'n', label: 'N', type: 'int', min: 0, max: 9, default: 3 },
  ],
  implementations: { preview: 'webgpu', final: 'webgpu' },
  license: { commercialUse: true },
  cost: 'realtime',
  randomized: false,
  requires: [],
};

describe('buildLayout', () => {
  it('hält die WGSL-Ausrichtung ein', () => {
    const l = buildLayout(manifest);
    const off = Object.fromEntries(l.fields.map((f) => [f.name, f.offset]));
    expect(off).toEqual({
      resolution: 0,
      origin: 8,
      canvas_size: 16,
      scale: 24,
      flags: 28,
      radius: 32,
      tint: 48, // vec3f auf 16 ausgerichtet
      on: 60, // passt in das Loch nach vec3f
      pos: 64,
      mode: 72,
      angle: 76,
      n: 80,
    });
    expect(l.size).toBe(96);
    expect(l.struct).toContain('tint: vec3f');
    expect(l.struct).toContain('n: i32');
  });
});

describe('shaderValue / packUniforms', () => {
  it('skaliert px und Punkte, rechnet Winkel und Farben um', () => {
    const [radius, tint, on, pos, mode, angle] = manifest.params;
    if (!radius || !tint || !on || !pos || !mode || !angle) throw new Error();
    expect(shaderValue(radius, 30, 0.5)).toBe(15);
    expect(shaderValue(tint, [1, 0.5, 0], 1)).toEqual([1, srgbToLinear(0.5), 0]);
    expect(shaderValue(on, false, 1)).toBe(0);
    expect(shaderValue(pos, [100, 40], 0.5)).toEqual([50, 20]);
    expect(shaderValue(mode, 'b', 1)).toBe(1);
    expect(shaderValue(angle, 90, 1)).toBeCloseTo(Math.PI / 2);
  });

  it('schreibt Werte an die richtigen Stellen', () => {
    const l = buildLayout(manifest);
    const buf = packUniforms(
      manifest,
      l,
      { radius: 40, n: 7 },
      {
        resolution: [800, 600],
        origin: [64, 128],
        canvasSize: [1000, 700],
        scale: 0.5,
      },
    );
    const dv = new DataView(buf);
    expect(dv.getFloat32(0, true)).toBe(800);
    expect(dv.getFloat32(12, true)).toBe(128);
    expect(dv.getFloat32(24, true)).toBe(0.5);
    expect(dv.getFloat32(32, true)).toBe(20);
    expect(dv.getUint32(60, true)).toBe(1);
    expect(dv.getUint32(72, true)).toBe(1);
    expect(dv.getInt32(80, true)).toBe(7);
  });
});

describe('Manifest v2: Seed, Palette, Zweitbild', () => {
  const m: EffectManifest = {
    ...manifest,
    params: [
      { key: 'seed', label: 'S', type: 'seed', default: 7 },
      {
        key: 'colors',
        label: 'P',
        type: 'palette',
        default: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      },
      { key: 'other', label: 'I', type: 'image', default: '' },
      { key: 'k', label: 'K', type: 'float', min: 0, max: 1, default: 0.5 },
    ],
  };

  it('legt Palette als array<vec4f, 16> mit Zähler an', () => {
    const l = buildLayout(m);
    const off = Object.fromEntries(l.fields.map((f) => [f.name, f.offset]));
    // Kern 0..28, seed u32 @32, Palette auf 16 ausgerichtet @48 (256 Byte), count @304, image @308, k @312
    expect(off).toMatchObject({ seed: 32, colors: 48, colors_count: 304, other: 308, k: 312 });
    expect(l.size).toBe(320);
    expect(l.struct).toContain('colors: array<vec4f, 16>');
    expect(l.struct).toContain('colors_count: u32');
  });

  it('packt Seed, Palette (linear) und Bild-Flag', () => {
    const l = buildLayout(m);
    const buf = packUniforms(
      m,
      l,
      {
        seed: 42,
        colors: [
          [1, 0, 0],
          [0.5, 0.5, 0.5],
          [0, 0, 1],
        ],
        other: 'abc',
      },
      {
        resolution: [1, 1],
        origin: [0, 0],
        canvasSize: [1, 1],
        scale: 1,
      },
    );
    const dv = new DataView(buf);
    expect(dv.getUint32(32, true)).toBe(42);
    expect(dv.getFloat32(48, true)).toBeCloseTo(1);
    expect(dv.getFloat32(48 + 16, true)).toBeCloseTo(srgbToLinear(0.5), 5);
    expect(dv.getFloat32(48 + 32 + 8, true)).toBeCloseTo(1);
    expect(dv.getUint32(304, true)).toBe(3);
    expect(dv.getUint32(308, true)).toBe(1);
    const image = m.params[2];
    if (!image) throw new Error('Parameter fehlt');
    expect(shaderValue(image, '', 1)).toBe(0);
  });
});
