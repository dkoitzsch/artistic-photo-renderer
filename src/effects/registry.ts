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

const folderOf = (path: string) => path.split('/')[2] ?? '';

function byFolder<T>(files: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(files).map(([path, v]) => [folderOf(path), v]));
}

/** Revision bleibt über HMR-Neuausführungen dieses Moduls hinweg monoton (Zähler im Store). */
function nextRevision(): number {
  const revs = Object.values(usePluginStore.getState().plugins).map((p) => p.revision);
  return Math.max(0, ...revs) + 1;
}

export function discoverPlugins(): Record<string, Plugin> {
  const manifests = byFolder(manifestFiles);
  const shaders = byFolder(shaderFiles);
  const scripts = byFolder(scriptFiles);
  const previews = byFolder(previewFiles);
  const workers = byFolder(workerFiles);
  const pythons = byFolder(pythonFiles);
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
async function loadScripts(plugins: Record<string, Plugin>): Promise<void> {
  const scripts = byFolder(scriptFiles);
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
  const plugins = discoverPlugins();
  usePluginStore.getState().setPlugins(plugins);
  await loadScripts(plugins);
})();

if (import.meta.hot) {
  import.meta.hot.accept();
}
