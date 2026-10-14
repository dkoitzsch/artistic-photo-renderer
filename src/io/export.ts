import { effectReach } from '../effects/reach';
import { ncLayers } from '../ml/split';
import { projectReach } from '../render/compositor';
import { getEngine } from '../render/runtime';
import type { Project } from '../state/project';
import { getProject, useAppStore } from '../state/store';

/** Kachelgröße des Exports (für Tests veränderbar). */
export const exportSettings = { tileSize: 2048 };

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'psd';
export type ExportOptions = {
  format: ExportFormat;
  /** JPEG/WebP 0…1 */
  quality: number;
  /** PSD: unbearbeitete Originale als ausgeblendete Ebenen */
  includeOriginals: boolean;
};

export const DEFAULT_EXPORT: ExportOptions = { format: 'png', quality: 0.92, includeOriginals: false };

const MIME: Record<Exclude<ExportFormat, 'psd'>, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Rendert das Projekt in voller Auflösung (gekachelt) und kodiert es (sRGB). */
export async function renderImage(
  project: Project,
  format: Exclude<ExportFormat, 'psd'> = 'png',
  quality = 0.92,
): Promise<Blob> {
  const engine = getEngine();
  if (!engine) throw new Error('WebGPU ist nicht verfügbar.');
  const { width, height } = project.canvas;
  const overlap = projectReach(project.root, (fx) => effectReach(fx, project.canvas));
  const pixels = await engine.renderFull(project, overlap, exportSettings.tileSize);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('2D-Kontext für den Export nicht verfügbar.');
  const img = new ImageData(pixels, width, height, { colorSpace: 'srgb' });
  if (format === 'jpeg') {
    // JPEG kennt keine Transparenz: auf Weiß
    const tmp = new OffscreenCanvas(width, height);
    tmp.getContext('2d')?.putImageData(img, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(tmp, 0, 0);
  } else {
    ctx.putImageData(img, 0, 0);
  }
  return canvas.convertToBlob({ type: MIME[format], quality });
}

/** PNG des Projekts (für Tests und ⌘E-Schnellexport). */
export function renderPng(project: Project): Promise<Blob> {
  return renderImage(project, 'png');
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

/** Startet einen Export; enthält das Projekt NC-Ergebnisse, erscheint zuerst die Export-Warnung. */
export async function exportAs(options: ExportOptions): Promise<void> {
  const project = getProject();
  if (project) {
    const nc = ncLayers(project);
    if (nc.length) {
      useAppStore.getState().setExportWarning({ layers: nc, options });
      return;
    }
  }
  await exportConfirmed(options);
}

/** Exportiert ohne Lizenzprüfung (nach bestätigter Warnung). */
export async function exportConfirmed(options: ExportOptions = DEFAULT_EXPORT): Promise<void> {
  const { notify, setBusy, upsertTask, removeTask } = useAppStore.getState();
  const project = getProject();
  const engine = getEngine();
  if (!project || !engine) {
    notify('error', 'Nichts zu exportieren: Es ist kein Bild geladen.');
    return;
  }
  const ext = options.format === 'jpeg' ? 'jpg' : options.format;
  const name = `${safeFileName(project.name)}.${ext}`;
  setBusy(`Export ${options.format.toUpperCase()} wird gerendert …`);
  const taskId = 10_000 + Math.floor(Math.random() * 1e6);
  try {
    const t0 = performance.now();
    let blob: Blob;
    if (options.format === 'psd') {
      upsertTask({ id: taskId, label: 'PSD-Export', detail: '', progress: 0 });
      // ag-psd wird erst beim ersten PSD-Export geladen (eigener Chunk)
      const { renderPsd } = await import('./psd');
      const bytes = await renderPsd(engine, project, {
        includeOriginals: options.includeOriginals,
        onProgress: (d, t) => {
          upsertTask({
            id: taskId,
            label: 'PSD-Export',
            detail: `Ebene ${d} von ${t}`,
            progress: t ? d / t : null,
          });
        },
      });
      blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/vnd.adobe.photoshop' });
    } else {
      blob = await renderImage(project, options.format, options.quality);
    }
    downloadBlob(blob, name);
    notify('info', `Exportiert: ${name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    notify('error', `Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    removeTask(taskId);
    setBusy(null);
  }
}

/** Schnellexport als PNG (mit Lizenzprüfung). */
export function exportPng(): Promise<void> {
  return exportAs(DEFAULT_EXPORT);
}

/** Kompatibilität: PNG ohne Prüfung. */
export function exportPngConfirmed(): Promise<void> {
  return exportConfirmed(DEFAULT_EXPORT);
}
