// Findet alle Effekt-Ordner unter /effects zur Build-Zeit (import.meta.glob) und validiert sie.
// Im Dev-Server lädt dieses Modul bei Änderungen an effects/ per HMR neu – neue Ordner erscheinen ohne Codeänderung.

import type { EffectModule } from './api';
import { buildLayout } from './layout';
import { usePluginStore, type Plugin } from './pluginStore';
import { validateManifest } from './validate';

const manifestFiles = import.meta.glob<string>('/effects/*/manifest.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const shaderFiles = import.meta.glob<string>('/effects/*/effect.wgsl', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const scriptFiles = import.meta.glob<{ default?: EffectModule }>('/effects/*/effect.ts');
// Weitere Ausführungsorte: CPU im Browser (Web Worker) und Python-Dienst (nur Existenz prüfen)
const workerFiles = import.meta.glob<string>('/effects/*/effect.worker.ts', {
  eager: true,
  query: '?url',
  import: 'default',
});
const pythonFiles = import.meta.glob<string>('/effects/*/effect.py', {
  eager: true,
  query: '?url',
  import: 'default',
});
const previewFiles = import.meta.glob<string>('/effects/*/preview.{jpg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Ordnername eines Plugin-Pfads (…/<ordner>/<datei>) */
const folderOf = (path: string) => path.split('/').at(-2) ?? '';

type ScriptLoader = () => Promise<{ default?: EffectModule }>;

/** Dateien aller Plugins, nach Ordner. */
type Sources = {
  manifests: Map<string, string>;
  shaders: Map<string, string>;
  scripts: Map<string, ScriptLoader>;
  previews: Map<string, string>;
  workers: Map<string, string>;
  pythons: Map<string, string>;
};

function bundledSources(): Sources {
  return {
    manifests: byFolder(manifestFiles),
    shaders: byFolder(shaderFiles),
    scripts: byFolder(scriptFiles),
    previews: byFolder(previewFiles),
    workers: byFolder(workerFiles),
    pythons: byFolder(pythonFiles),
  };
}

/**
 * Test-Effekte unter tests/effects/ (nur im Dev-Server und nur mit localStorage['bls.testEffects'] = '1').
 * Sie stehen fest im Repository statt zur Laufzeit angelegt zu werden; im Produktions-Build fehlen sie.
 */
async function testSources(): Promise<Sources | null> {
  if (!import.meta.env.DEV) return null;
  let on: boolean;
  try {
    on = localStorage.getItem('bls.testEffects') === '1';
  } catch {
    on = false;
  }
  if (!on) return null;
  const load = async (files: Record<string, () => Promise<string>>) =>
    new Map(
      await Promise.all(Object.entries(files).map(async ([path, f]) => [folderOf(path), await f()] as const)),
    );
  return {
    manifests: await load(
      import.meta.glob<string>('/tests/effects/*/manifest.json', { query: '?raw', import: 'default' }),
    ),
    shaders: await load(
      import.meta.glob<string>('/tests/effects/*/effect.wgsl', { query: '?raw', import: 'default' }),
    ),
    scripts: byFolder(import.meta.glob<{ default?: EffectModule }>('/tests/effects/*/effect.ts')),
    previews: new Map(),
    workers: await load(
      import.meta.glob<string>('/tests/effects/*/effect.worker.ts', { query: '?url', import: 'default' }),
    ),
    pythons: await load(
      import.meta.glob<string>('/tests/effects/*/effect.py', { query: '?url', import: 'default' }),
    ),
  };
}

function mergeSources(a: Sources, b: Sources | null): Sources {
  if (!b) return a;
  const m = <T>(x: Map<string, T>, y: Map<string, T>) => new Map([...x, ...y]);
  return {
    manifests: m(a.manifests, b.manifests),
    shaders: m(a.shaders, b.shaders),
    scripts: m(a.scripts, b.scripts),
    previews: m(a.previews, b.previews),
    workers: m(a.workers, b.workers),
    pythons: m(a.pythons, b.pythons),
  };
}

function byFolder<T>(files: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(files).map(([path, v]) => [folderOf(path), v]));
}

/** Revision bleibt über HMR-Neuausführungen dieses Moduls hinweg monoton (Zähler im Store). */
function nextRevision(): number {
  const revs = Object.values(usePluginStore.getState().plugins).map((p) => p.revision);
  return Math.max(0, ...revs) + 1;
}

export function discoverPlugins(sources: Sources = bundledSources()): Record<string, Plugin> {
  const { manifests, shaders, scripts, previews, workers, pythons } = sources;
  const folders = new Set([...manifests.keys(), ...shaders.keys()]);
  const revision = nextRevision();
  const out: Record<string, Plugin> = {};

  for (const folder of [...folders].sort()) {
    if (folder.startsWith('_') || folder.startsWith('.')) continue; // Vorlagen
    const errors: string[] = [];
    let manifest: Plugin['manifest'] = null;
    const rawManifest = manifests.get(folder);
    if (rawManifest === undefined) errors.push('manifest.json fehlt.');
    else {
      let json: unknown;
      try {
        json = JSON.parse(rawManifest);
      } catch (e) {
        errors.push(`manifest.json ist kein gültiges JSON: ${(e as Error).message}`);
      }
      if (json !== undefined) {
        const res = validateManifest(json, folder);
        if (res.ok) manifest = res.manifest;
        else errors.push(...res.errors);
      }
    }
    const wgsl = shaders.get(folder) ?? null;
    const impl = manifest?.implementations ?? { preview: 'webgpu', final: 'webgpu' };
    const uses = (x: string) => impl.preview === x || impl.final === x;
    if (uses('webgpu') && wgsl === null)
      errors.push('effect.wgsl fehlt (Pflicht für Ausführung auf der GPU).');
    if (uses('browser-cpu') && !workers.has(folder))
      errors.push('effect.worker.ts fehlt (Pflicht für Ausführung „browser-cpu“).');
    if (uses('python') && !pythons.has(folder))
      errors.push('effect.py fehlt (Pflicht für Ausführung „python“).');
    const hasScript = scripts.has(folder);
    if (uses('webgpu') && wgsl !== null && !hasScript && !/fn\s+effect\s*\(/.test(wgsl))
      errors.push('Einstufiger Effekt: effect.wgsl muss fn effect(p: vec2i) -> vec4f definieren.');

    out[folder] = {
      folder,
      manifest,
      wgsl,
      layout: manifest ? buildLayout(manifest) : null,
      hasScript,
      module: null,
      previewUrl: previews.get(folder) ?? null,
      status: errors.length ? 'error' : 'pending',
      errors,
      revision,
    };
  }
  return out;
}

/** Lädt die effect.ts-Module; Fehler landen beim jeweiligen Plugin statt die App anzuhalten. */
async function loadScripts(
  plugins: Record<string, Plugin>,
  scripts: Map<string, ScriptLoader>,
): Promise<void> {
  const { updatePlugin } = usePluginStore.getState();
  await Promise.all(
    Object.values(plugins).map(async (p) => {
      const load = scripts.get(p.folder);
      if (!load || p.status === 'error') return;
      try {
        const mod = await load();
        if (typeof mod.default?.run !== 'function')
          throw new Error('effect.ts muss "export default defineEffect({ run })" exportieren.');
        updatePlugin(p.folder, { module: mod.default });
      } catch (e) {
        updatePlugin(p.folder, { status: 'error', errors: [`effect.ts: ${(e as Error).message}`] });
      }
    }),
  );
}

/** Wird nach dem Laden (und nach jedem HMR-Update) aufgerufen; der Effekt-Kern kompiliert danach die Shader. */
export const pluginsReady: Promise<void> = (async () => {
  const sources = mergeSources(bundledSources(), await testSources());
  const plugins = discoverPlugins(sources);
  usePluginStore.getState().setPlugins(plugins);
  await loadScripts(plugins, sources.scripts);
})();

if (import.meta.hot) {
  import.meta.hot.accept();
}
