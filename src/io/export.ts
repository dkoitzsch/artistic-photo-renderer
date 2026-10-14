import { effectReach } from '../effects/reach';
import { projectReach } from '../render/compositor';
import { getEngine } from '../render/runtime';
import type { Project } from '../state/project';
import { getProject, useAppStore } from '../state/store';

/** Kachelgröße des Exports (für Tests veränderbar). */
export const exportSettings = { tileSize: 2048 };

/** Rendert das Projekt in voller Auflösung (gekachelt) und kodiert es als PNG (sRGB). */
export async function renderPng(project: Project): Promise<Blob> {
  const engine = getEngine();
  if (!engine) throw new Error('WebGPU ist nicht verfügbar.');
  const { width, height } = project.canvas;
  const overlap = projectReach(project.root, effectReach);
  const pixels = await engine.renderFull(project, overlap, exportSettings.tileSize);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('2D-Kontext für den Export nicht verfügbar.');
  ctx.putImageData(new ImageData(pixels, width, height, { colorSpace: 'srgb' }), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function safeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'export';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** Exportiert das aktuelle Projekt als PNG-Download. */
export async function exportPng(): Promise<void> {
  const { notify, setBusy } = useAppStore.getState();
  const project = getProject();
  if (!project) {
    notify('error', 'Nichts zu exportieren: Es ist kein Bild geladen.');
    return;
  }
  setBusy('Export wird gerendert …');
  try {
    const t0 = performance.now();
    const blob = await renderPng(project);
    const name = `${safeFileName(project.name)}.png`;
    downloadBlob(blob, name);
    notify('info', `Exportiert: ${name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    notify('error', `Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setBusy(null);
  }
}
