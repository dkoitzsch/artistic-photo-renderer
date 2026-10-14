// Projektdatei .blurstudio (= ZIP): project.json + originals/<hash>.<ext> (+ masks/, focus/, depth/ ab Phase 2).

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Project } from '../state/project';
import { parseProject } from './projectSchema';

export const PROJECT_EXTENSION = '.blurstudio';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function packProject(project: Project, originals: Map<string, Uint8Array>): Uint8Array {
  const files: Zippable = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
  };
  for (const o of Object.values(project.originals)) {
    const bytes = originals.get(o.id);
    if (!bytes) throw new Error(`Original ${o.fileName} fehlt.`);
    // Bilder sind bereits komprimiert → speichern statt erneut komprimieren.
    files[`originals/${o.id}.${EXT[o.mimeType] ?? 'bin'}`] = [bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

export function unpackProject(zip: Uint8Array): {
  project: Project;
  originals: Map<string, Uint8Array<ArrayBuffer>>;
} {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Error('Die Datei ist keine gültige Projektdatei (ZIP).');
  }
  const json = entries['project.json'];
  if (!json) throw new Error('project.json fehlt in der Projektdatei.');
  let data: unknown;
  try {
    data = JSON.parse(strFromU8(json));
  } catch {
    throw new Error('project.json ist kein gültiges JSON.');
  }
  const project = parseProject(data);
  const originals = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [path, bytes] of Object.entries(entries)) {
    const m = /^originals\/([0-9a-f]{64})\.\w+$/.exec(path);
    if (m?.[1]) originals.set(m[1], bytes as Uint8Array<ArrayBuffer>);
  }
  for (const id of Object.keys(project.originals))
    if (!originals.has(id)) throw new Error(`Original ${id.slice(0, 8)} fehlt in der Projektdatei.`);
  return { project, originals };
}
