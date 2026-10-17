import { describe, expect, it } from 'vitest';
import {
  instancesFrom,
  mergePresets,
  parsePresetFile,
  presetEffectsFrom,
  PRESET_FILE_FORMAT,
} from '../../src/presets/model';
import type { EffectInstance } from '../../src/state/project';

const fx = (id: string, extra: Partial<EffectInstance> = {}): EffectInstance => ({
  instanceId: id,
  effectId: 'gaussian-blur',
  effectVersion: '1.1.0',
  enabled: true,
  strength: 0.8,
  params: { radius: 12, palette: [[1, 0, 0]] },
  region: 'whole',
  ...extra,
});

describe('Stapel-Presets', () => {
  it('übernimmt Parameter, Mischmodus und Kartenmasken; verwirft Ebenenmasken und IDs', () => {
    const effects = [
      fx('a', { blendMode: 'screen', decoupled: ['radius'] }),
      fx('b', { mask: { kind: 'map', map: 'luminance', from: 0, to: 0.3, feather: 0.05, invert: false } }),
      fx('c', { mask: { kind: 'layer', layerId: 'L1', invert: true } }),
    ];
    const preset = presetEffectsFrom(effects);
    expect(preset[0]).toMatchObject({ effectId: 'gaussian-blur', blendMode: 'screen', strength: 0.8 });
    expect(preset[0]).not.toHaveProperty('decoupled');
    expect(preset[0]).not.toHaveProperty('instanceId');
    expect(preset[1]?.mask).toMatchObject({ kind: 'map', map: 'luminance' });
    expect(preset[2]).not.toHaveProperty('mask');
    // tiefe Kopie: Änderungen am Stapel wirken nicht auf das Preset
    const pal = effects[0]?.params.palette as number[][];
    (pal[0] as number[])[0] = 0;
    expect((preset[0]?.params.palette as number[][])[0]?.[0]).toBe(1);

    let n = 0;
    const back = instancesFrom(preset, () => `new${n++}`);
    expect(back.map((e) => e.instanceId)).toEqual(['new0', 'new1', 'new2']);
    expect(back[1]?.mask).toEqual(effects[1]?.mask);
  });
});

describe('Preset-Datei', () => {
  const file = {
    format: PRESET_FILE_FORMAT,
    version: 1,
    effects: [
      {
        id: 'e1',
        effectId: 'haze',
        effectVersion: '1.0.0',
        name: 'Dunst',
        values: { amount: 30 },
        createdAt: '',
      },
    ],
    stacks: [{ id: 's1', name: 'Stapel', effects: presetEffectsFrom([fx('a')]), createdAt: '' }],
  };

  it('prüft Format, Version und Inhalt', () => {
    expect(parsePresetFile(JSON.parse(JSON.stringify(file))).effects[0]?.name).toBe('Dunst');
    expect(() => parsePresetFile({ ...file, format: 'x' })).toThrow(/Keine Preset-Datei/);
    expect(() => parsePresetFile({ ...file, version: 2 })).toThrow(/Version 2/);
    expect(() => parsePresetFile({ ...file, effects: [{ id: 'x' }] })).toThrow(/unvollständig/);
    expect(() =>
      parsePresetFile({
        ...file,
        stacks: [{ ...file.stacks[0], effects: [{ ...fx('a'), mask: { kind: 'layer', layerId: 'x' } }] }],
      }),
    ).toThrow(/Kartenbereiche/);
    expect(() =>
      parsePresetFile({ ...file, effects: [{ ...file.effects[0], thumbnail: 'javascript:alert(1)' }] }),
    ).toThrow(/Vorschaubild/);
  });

  it('Zusammenführen ersetzt gleiche IDs und hängt neue an', () => {
    const a = [
      { id: '1', v: 'alt' },
      { id: '2', v: 'b' },
    ];
    expect(
      mergePresets(a, [
        { id: '1', v: 'neu' },
        { id: '3', v: 'c' },
      ]),
    ).toEqual([
      { id: '2', v: 'b' },
      { id: '1', v: 'neu' },
      { id: '3', v: 'c' },
    ]);
  });
});
