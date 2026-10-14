import { getProject, useAppStore } from '../state/store';
import { downloadBlob, safeFileName } from './export';
import { packProject, PROJECT_EXTENSION } from './projectFile';
import { depthIds, maskIds } from '../state/project';
import { loadDepth, loadMask, loadOriginal } from './storage';

type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/** Sichert das aktuelle Projekt als .blurstudio-Datei (Speichern-Dialog, sonst Download). */
export async function saveProjectFile(): Promise<void> {
  const { notify } = useAppStore.getState();
  const project = getProject();
  if (!project) return;
  const fileName = `${safeFileName(project.name)}${PROJECT_EXTENSION}`;
  try {
    const originals = new Map<string, Uint8Array>();
    for (const o of Object.values(project.originals)) {
      const f = await loadOriginal(o.id);
      if (!f) throw new Error(`Original ${o.fileName} fehlt im lokalen Speicher.`);
      originals.set(o.id, new Uint8Array(await f.arrayBuffer()));
    }
    const masks = new Map<string, Uint8Array>();
    for (const id of maskIds(project)) {
      const bytes = await loadMask(id);
      if (!bytes) throw new Error(`Maske ${id.slice(0, 8)} fehlt im lokalen Speicher.`);
      masks.set(id, bytes);
    }
    const depth = new Map<string, Uint8Array>();
    for (const id of depthIds(project)) {
      const bytes = await loadDepth(id);
      if (!bytes) throw new Error(`Tiefenkarte ${id.slice(0, 8)} fehlt im lokalen Speicher.`);
      depth.set(id, bytes);
    }
    const zip = packProject(project, originals, masks, depth);
    const blob = new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (picker) {
      let handle: FileSystemFileHandle;
      try {
        handle = await picker({
          suggestedName: fileName,
          types: [
            {
              description: 'Blur & Layer Studio Projekt',
              accept: { 'application/zip': [PROJECT_EXTENSION] },
            },
          ],
        });
      } catch {
        return; // abgebrochen
      }
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      downloadBlob(blob, fileName);
    }
    notify('info', `Projektdatei gesichert: ${fileName}`);
  } catch (e) {
    notify('error', `Sichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
}
