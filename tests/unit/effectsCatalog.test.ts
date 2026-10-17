// Mindestanforderungen der Spec „Effekte“ (Abschnitt 5) an alle mitgelieferten Effekte.
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/effects/validate';

const raw = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, v]) => [path.split('/').at(-2) ?? '', v]));
const manifests = raw(
  import.meta.glob<string>('/effects/*/manifest.json', { eager: true, query: '?raw', import: 'default' }),
);
const has = (files: Record<string, unknown>) =>
  new Set(Object.keys(files).map((p) => p.split('/').at(-2) ?? ''));
const shaders = has(import.meta.glob('/effects/*/effect.wgsl', { query: '?raw' }));
const workers = has(import.meta.glob('/effects/*/effect.worker.ts', { query: '?url' }));
const pythons = has(import.meta.glob('/effects/*/effect.py', { query: '?url' }));
const folders = [...manifests.keys()].filter((f) => !f.startsWith('_')).sort();

describe('Effekt-Katalog', () => {
  it.each(folders)(
    '%s: gültiges Manifest, ≥ 2 Presets, Lizenzangabe, Implementierung vorhanden',
    (folder) => {
      const json = JSON.parse(manifests.get(folder) ?? '{}') as { license?: unknown };
      const r = validateManifest(json, folder);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      const m = r.manifest;
      expect(m.presets?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(json.license, 'license im Manifest').toBeDefined();
      const impls = new Set([m.implementations.preview, m.implementations.final]);
      if (impls.has('webgpu')) expect(shaders.has(folder)).toBe(true);
      if (impls.has('browser-cpu')) expect(workers.has(folder)).toBe(true);
      if (impls.has('python')) expect(pythons.has(folder)).toBe(true);
      for (const p of m.presets ?? []) expect(p.name.trim().length).toBeGreaterThan(0);
    },
  );
});
