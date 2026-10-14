// Lokaler Speicher im Origin Private File System (OPFS):
//   originals/<hash>        unveränderte Bilddateien (geteilt zwischen Projekten)
//   projects/<id>.json      Projektbaum
//   thumbs/<id>.webp        Miniatur für die Projektübersicht
//   masks/<id>.png          16-Bit-Masken (unveränderlich, jede Änderung = neue ID)

import { maskIds, type Project } from '../state/project';
import { parseProject } from './projectSchema';

export type ProjectSummary = { id: string; name: string; updatedAt: string; width: number; height: number };

async function dir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

async function writeFile(
  d: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string | Uint8Array<ArrayBuffer>,
) {
  const fh = await d.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function readFile(d: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await d.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function hasOriginal(id: string): Promise<boolean> {
  return (await readFile(await dir('originals'), id)) !== null;
}

export async function saveOriginal(id: string, data: Blob | Uint8Array<ArrayBuffer>): Promise<void> {
  const d = await dir('originals');
  if (await readFile(d, id)) return; // unveränderlich: einmal geschrieben, nie überschrieben
  await writeFile(d, id, data);
}

export async function loadOriginal(id: string): Promise<File | null> {
  return readFile(await dir('originals'), id);
}

export async function saveMask(id: string, png: Uint8Array<ArrayBuffer>): Promise<void> {
  const d = await dir('masks');
  if (await readFile(d, `${id}.png`)) return;
  await writeFile(d, `${id}.png`, png);
}

export async function loadMask(id: string): Promise<Uint8Array | null> {
  const f = await readFile(await dir('masks'), `${id}.png`);
  return f ? new Uint8Array(await f.arrayBuffer()) : null;
}

export async function saveProject(project: Project): Promise<void> {
  await writeFile(await dir('projects'), `${project.id}.json`, JSON.stringify(project));
}

export async function loadProject(id: string): Promise<Project> {
  const f = await readFile(await dir('projects'), `${id}.json`);
  if (!f) throw new Error('Projekt nicht gefunden.');
  return parseProject(JSON.parse(await f.text()));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const d = await dir('projects');
  const out: ProjectSummary[] = [];
  for await (const [name, handle] of d.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const p = parseProject(JSON.parse(await (await handle.getFile()).text()));
      out.push({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        width: p.canvas.width,
        height: p.canvas.height,
      });
    } catch {
      // beschädigte Datei überspringen
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveThumbnail(id: string, blob: Blob): Promise<void> {
  await writeFile(await dir('thumbs'), `${id}.webp`, blob);
}

export async function loadThumbnail(id: string): Promise<File | null> {
  return readFile(await dir('thumbs'), `${id}.webp`);
}

/** Löscht ein Projekt und alle Originale, die kein anderes Projekt mehr braucht. */
export async function deleteProject(id: string): Promise<void> {
  const projects = await dir('projects');
  await projects.removeEntry(`${id}.json`).catch(() => undefined);
  await (await dir('thumbs')).removeEntry(`${id}.webp`).catch(() => undefined);
  const used = new Set<string>();
  const usedMasks = new Set<string>();
  for (const s of await listProjects()) {
    const p = await loadProject(s.id).catch(() => null);
    if (!p) continue;
    for (const o of Object.keys(p.originals)) used.add(o);
    for (const m of maskIds(p)) usedMasks.add(`${m}.png`);
  }
  const originals = await dir('originals');
  for await (const name of originals.keys()) if (!used.has(name)) await originals.removeEntry(name);
  const masks = await dir('masks');
  for await (const name of masks.keys()) if (!usedMasks.has(name)) await masks.removeEntry(name);
}
