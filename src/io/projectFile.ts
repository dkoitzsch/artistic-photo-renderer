// Projektdatei .blurstudio (= ZIP): project.json + originals/<hash>.<ext> + masks/<id>.png + depth/<id>.png (16 Bit).

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { depthIds, maskIds, type Project } from '../state/project';
import { parseProject } from './projectSchema';

export const PROJECT_EXTENSION = '.blurstudio';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function packProject(
  project: Project,
  originals: Map<string, Uint8Array>,
  masks: Map<string, Uint8Array> = new Map(),
  depth: Map<string, Uint8Array> = new Map(),
): Uint8Array {
  const files: Zippable = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
  };
  for (const o of Object.values(project.originals)) {
    const bytes = originals.get(o.id);
    if (!bytes) throw new Error(`Original ${o.fileName} fehlt.`);
    // Bilder sind bereits komprimiert → speichern statt erneut komprimieren.
    files[`originals/${o.id}.${EXT[o.mimeType] ?? 'bin'}`] = [bytes, { level: 0 }];
  }
  for (const id of maskIds(project)) {
    const bytes = masks.get(id);
    if (!bytes) throw new Error(`Maske ${id.slice(0, 8)} fehlt.`);
    files[`masks/${id}.png`] = [bytes, { level: 0 }];
  }
  for (const id of depthIds(project)) {
    const bytes = depth.get(id);
    if (!bytes) throw new Error(`Tiefenkarte ${id.slice(0, 8)} fehlt.`);
    files[`depth/${id}.png`] = [bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

export function unpackProject(zip: Uint8Array): {
  project: Project;
  originals: Map<string, Uint8Array<ArrayBuffer>>;
  masks: Map<string, Uint8Array<ArrayBuffer>>;
  depth: Map<string, Uint8Array<ArrayBuffer>>;
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
  const masks = new Map<string, Uint8Array<ArrayBuffer>>();
  const depth = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [path, bytes] of Object.entries(entries)) {
    const d = /^depth\/([\w-]+)\.png$/.exec(path);
    if (d?.[1]) depth.set(d[1], bytes as Uint8Array<ArrayBuffer>);
    const o = /^originals\/([0-9a-f]{64})\.\w+$/.exec(path);
    if (o?.[1]) originals.set(o[1], bytes as Uint8Array<ArrayBuffer>);
    const m = /^masks\/([\w-]+)\.png$/.exec(path);
    if (m?.[1]) masks.set(m[1], bytes as Uint8Array<ArrayBuffer>);
  }
  for (const id of Object.keys(project.originals))
    if (!originals.has(id)) throw new Error(`Original ${id.slice(0, 8)} fehlt in der Projektdatei.`);
  for (const id of maskIds(project))
    if (!masks.has(id)) throw new Error(`Maske ${id.slice(0, 8)} fehlt in der Projektdatei.`);
  for (const id of depthIds(project))
    if (!depth.has(id)) throw new Error(`Tiefenkarte ${id.slice(0, 8)} fehlt in der Projektdatei.`);
  return { project, originals, masks, depth };
}
