import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/effects/validate';

const base = () => ({
  id: 'echo-offset',
  name: 'Echo-Versatz',
  version: '1.0.0',
  category: 'Überschneidung',
  inputs: ['source', 'mask', 'focus', 'depth'],
  passes: 1,
  params: [
    { key: 'copies', label: 'Kopien', type: 'int', min: 1, max: 12, default: 3 },
    {
      key: 'distance',
      label: 'Abstand',
      type: 'float',
      min: 0,
      max: 400,
      default: 40,
      unit: 'px',
      scale: 'log',
    },
    { key: 'angle', label: 'Richtung', type: 'angle', default: 0 },
    { key: 'tint', label: 'Farbe', type: 'color', default: [1, 1, 1] },
  ],
});

describe('validateManifest', () => {
  it('akzeptiert das Beispiel aus der Spec', () => {
    const r = validateManifest(base(), 'echo-offset');
    expect(r.ok).toBe(true);
  });

  it('meldet alle Fehler auf einmal', () => {
    const m = {
      ...base(),
      id: 'Echo Offset',
      version: '1.0',
      inputs: ['source', 'normals'],
      params: [
        { key: 'copies', label: 'Kopien', type: 'int', min: 5, max: 1, default: 3 },
        { key: 'copies', label: 'Doppelt', type: 'bool', default: 'ja' },
        { key: 'scale', label: 'Reserviert', type: 'float', min: 0, max: 1, default: 0 },
        { key: 'mode', label: 'Modus', type: 'enum', options: [{ value: 'a', label: 'A' }], default: 'b' },
        { key: 'x', label: 'X', type: 'vector', default: 0 },
      ],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join('\n');
    expect(text).toContain('kebab-case');
    expect(text).toContain('"version"');
    expect(text).toContain('"inputs"');
    expect(text).toContain('"min" < "max"');
    expect(text).toContain('doppelt');
    expect(text).toContain('reserviert');
    expect(text).toContain('keine der Optionen');
    expect(text).toContain('"type" muss');
    expect(r.errors.length).toBeGreaterThanOrEqual(8);
  });

  it('verlangt id = Ordnername', () => {
    const r = validateManifest(base(), 'anderer-ordner');
    expect(r.ok).toBe(false);
  });

  it('prüft reach, visibleIf und Presets', () => {
    const ok = validateManifest({
      ...base(),
      reach: 'distance * copies + max(1, 2)',
      visibleIf: { tint: 'copies!=1' },
      presets: [{ name: 'Weit', values: { distance: 200 } }],
    });
    expect(ok.ok).toBe(true);
    const bad = validateManifest({
      ...base(),
      reach: 'radius + 1',
      visibleIf: { nope: 'copies' },
      presets: [{ name: 'X', values: { foo: 1 } }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join()).toContain('radius');
      expect(bad.errors.join()).toContain('nope');
      expect(bad.errors.join()).toContain('foo');
    }
  });

  it('lehnt Nicht-Objekte ab', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });
});
