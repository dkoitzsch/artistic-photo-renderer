// Speichert das aktuelle Projekt 1 s nach der letzten Änderung im OPFS, samt Miniatur.

import { getEngine } from '../render/runtime';
import type { Project } from '../state/project';
import { selectProject, useAppStore } from '../state/store';
import { saveProject, saveThumbnail } from './storage';

export const AUTOSAVE_DELAY_MS = 1000;
const THUMB_EDGE = 320;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Project | null = null;
/** Liest den Zustand frisch (kann sich während await ändern). */
const hasPending = (): boolean => pending !== null;

async function makeThumbnail(): Promise<Blob | null> {
  const preview = await getEngine()?.readPreview();
  if (!preview) return null;
  const src = new OffscreenCanvas(preview.width, preview.height);
  src.getContext('2d')?.putImageData(new ImageData(preview.pixels, preview.width, preview.height), 0, 0);
  const s = Math.min(1, THUMB_EDGE / Math.max(preview.width, preview.height));
  const dst = new OffscreenCanvas(Math.round(preview.width * s), Math.round(preview.height * s));
  const ctx = dst.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
  return dst.convertToBlob({ type: 'image/webp', quality: 0.85 });
}

export async function flushAutosave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const project = pending;
  pending = null;
  if (!project) return;
  const { setSaveState } = useAppStore.getState();
  setSaveState('saving');
  try {
    await saveProject(project);
    // Miniatur nur, solange die Vorschau noch dieses Projekt zeigt.
    const current = selectProject(useAppStore.getState());
    const thumb = current?.id === project.id ? await makeThumbnail() : null;
    if (thumb) await saveThumbnail(project.id, thumb);
    setSaveState(hasPending() ? 'pending' : 'saved');
  } catch (e) {
    setSaveState('error');
    useAppStore
      .getState()
      .notify('error', `Autosave fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Startet die Überwachung des Projekts (einmal beim App-Start). */
export function startAutosave(): () => void {
  let last = selectProject(useAppStore.getState());
  const unsub = useAppStore.subscribe((s) => {
    const p = selectProject(s);
    if (p === last) return;
    const switched = p?.id !== last?.id;
    last = p;
    if (!p || switched) return; // neu geöffnete Projekte sind bereits gespeichert
    pending = p;
    useAppStore.getState().setSaveState('pending');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushAutosave(), AUTOSAVE_DELAY_MS);
  });
  const onHide = () => void flushAutosave();
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
  };
}
