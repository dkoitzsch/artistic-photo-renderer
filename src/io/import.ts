// Öffnen von Bildern (neues Projekt), Projektdateien und gespeicherten Projekten.

import { getEngine } from '../render/runtime';
import { openProject } from '../state/commands';
import {
  createProjectFromImage,
  depthIds,
  maskIds,
  newId,
  type OriginalRef,
  type Project,
} from '../state/project';
import { decodeMaskPng } from './maskCodec';
import { useAppStore } from '../state/store';
import { fitToViewport } from '../state/viewActions';
import { sha256Hex } from './hash';
import { PROJECT_EXTENSION, unpackProject } from './projectFile';
import {
  loadDepth,
  loadMask,
  loadOriginal,
  loadProject,
  saveDepth,
  saveMask,
  saveOriginal,
  saveProject,
} from './storage';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_TYPES, PROJECT_EXTENSION].join(',');

/** Ab dieser Größe nur Hinweis: Export und Performance-Ziele sind auf 24 MP ausgelegt. */
const MAX_TARGET_PIXELS = 24_000_000;

const isAccepted = (type: string) => (ACCEPTED_TYPES as readonly string[]).includes(type);
const isHeic = (file: File) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function decode(bytes: Blob): Promise<ImageBitmap> {
  return createImageBitmap(bytes, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
}

type Bytes = (id: string) => Promise<Uint8Array | null>;

/** Stellt sicher, dass alle Originale und Masken eines Projekts auf der GPU liegen. */
export async function uploadAssets(
  project: Project,
  getOriginal: (o: OriginalRef) => Promise<Blob | null>,
  getMask: Bytes = loadMask,
  getDepth: Bytes = loadDepth,
): Promise<void> {
  const engine = getEngine();
  if (!engine) throw new Error('WebGPU ist nicht verfügbar.');
  for (const o of Object.values(project.originals)) {
    if (engine.sources.has(o.id)) continue;
    const blob = await getOriginal(o);
    if (!blob) throw new Error(`Original ${o.fileName} fehlt im lokalen Speicher.`);
    const bitmap = await decode(blob);
    engine.sources.add(o.id, bitmap);
    bitmap.close();
  }
  const masks = maskIds(project);
  for (const id of masks) {
    if (engine.sources.hasMask(id)) continue;
    const bytes = await getMask(id);
    if (!bytes) throw new Error(`Maske ${id.slice(0, 8)} fehlt im lokalen Speicher.`);
    const m = decodeMaskPng(bytes);
    engine.sources.addMask(id, m.width, m.height, m.data);
  }
  const depth = depthIds(project);
  for (const id of depth) {
    if (engine.sources.hasMask(id)) continue;
    const bytes = await getDepth(id);
    if (!bytes) throw new Error(`Tiefenkarte ${id.slice(0, 8)} fehlt im lokalen Speicher.`);
    const m = decodeMaskPng(bytes);
    engine.sources.addMask(id, m.width, m.height, m.data);
  }
  engine.sources.retainOnly(new Set(Object.keys(project.originals)), new Set([...masks, ...depth]));
}

function show(project: Project): void {
  getEngine()?.resetPreview();
  openProject(project);
  fitToViewport();
}

function guard(): boolean {
  const { gpu, notify } = useAppStore.getState();
  if (gpu.state !== 'ready' || !getEngine()) {
    notify('error', 'Öffnen nicht möglich: WebGPU ist nicht verfügbar.');
    return false;
  }
  return true;
}

/** Öffnet eine Datei: Bild → neues Projekt, .blurstudio → Projekt. */
export async function openFile(file: File): Promise<boolean> {
  if (file.name.toLowerCase().endsWith(PROJECT_EXTENSION)) return openProjectFile(file);
  return importImageFile(file);
}

/** Lädt eine Bilddatei als Original und legt ein neues Projekt an. */
export async function importImageFile(file: File): Promise<boolean> {
  const { notify, gpu, setBusy } = useAppStore.getState();
  if (!guard() || gpu.state !== 'ready') return false;
  if (isHeic(file)) {
    notify(
      'error',
      `${file.name}: HEIC wird von Chrome nicht dekodiert. Bitte als JPEG oder PNG exportieren.`,
    );
    return false;
  }
  if (!isAccepted(file.type)) {
    notify('error', `${file.name}: Format nicht unterstützt (JPEG, PNG, WebP oder ${PROJECT_EXTENSION}).`);
    return false;
  }
  setBusy(`${file.name} wird geöffnet …`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bitmap: ImageBitmap;
    try {
      bitmap = await decode(new Blob([bytes], { type: file.type }));
    } catch {
      notify('error', `${file.name}: Die Datei konnte nicht dekodiert werden.`);
      return false;
    }
    const { width, height } = bitmap;
    if (width > gpu.maxTextureSize || height > gpu.maxTextureSize) {
      bitmap.close();
      notify(
        'error',
        `${file.name}: ${width} × ${height} px überschreitet das GPU-Limit von ${gpu.maxTextureSize} px.`,
      );
      return false;
    }
    const id = await sha256Hex(bytes);
    await saveOriginal(id, bytes);
    getEngine()?.sources.add(id, bitmap);
    bitmap.close();

    const project = createProjectFromImage(
      { id, fileName: file.name, mimeType: file.type, width, height },
      undefined,
      useAppStore.getState().licenseMode,
    );
    await uploadAssets(project, () => Promise.resolve(null));
    await saveProject(project);
    show(project);
    if (width * height > MAX_TARGET_PIXELS)
      notify(
        'info',
        `${file.name} hat ${((width * height) / 1e6).toFixed(1)} MP; ausgelegt ist die App auf 24 MP.`,
      );
    else notify('info', `${file.name} geladen (${width} × ${height} px).`);
    return true;
  } catch (e) {
    notify('error', `${file.name}: ${errorText(e)}`);
    return false;
  } finally {
    setBusy(null);
  }
}

/** Öffnet eine .blurstudio-Datei als neues lokales Projekt (neue ID, damit nichts überschrieben wird). */
export async function openProjectFile(file: File): Promise<boolean> {
  const { notify, setBusy } = useAppStore.getState();
  if (!guard()) return false;
  setBusy(`${file.name} wird geöffnet …`);
  try {
    const {
      project: loaded,
      originals,
      masks,
      depth,
    } = unpackProject(new Uint8Array(await file.arrayBuffer()));
    for (const [id, bytes] of originals) {
      if ((await sha256Hex(bytes)) !== id)
        throw new Error('Ein Original ist beschädigt (Prüfsumme stimmt nicht).');
      await saveOriginal(id, bytes);
    }
    for (const [id, bytes] of masks) await saveMask(id, bytes);
    for (const [id, bytes] of depth) await saveDepth(id, bytes);
    const project: Project = { ...loaded, id: newId(), updatedAt: new Date().toISOString() };
    await uploadAssets(project, (o) => {
      const b = originals.get(o.id);
      return Promise.resolve(b ? new Blob([b], { type: o.mimeType }) : null);
    });
    await saveProject(project);
    show(project);
    notify('info', `Projekt „${project.name}“ geöffnet.`);
    return true;
  } catch (e) {
    notify('error', `${file.name}: ${errorText(e)}`);
    return false;
  } finally {
    setBusy(null);
  }
}

/** Öffnet ein Projekt aus dem lokalen Speicher (Projektübersicht). */
export async function openStoredProject(id: string): Promise<boolean> {
  const { notify, setBusy } = useAppStore.getState();
  if (!guard()) return false;
  setBusy('Projekt wird geöffnet …');
  try {
    const project = await loadProject(id);
    await uploadAssets(project, async (o) => {
      const f = await loadOriginal(o.id);
      return f ? new Blob([f], { type: o.mimeType }) : null;
    });
    show(project);
    return true;
  } catch (e) {
    notify('error', `Projekt konnte nicht geöffnet werden: ${errorText(e)}`);
    return false;
  } finally {
    setBusy(null);
  }
}
