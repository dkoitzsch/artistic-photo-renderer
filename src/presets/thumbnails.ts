// Vorschaubilder für Presets (JPEG als data:-URL, klein, damit die Preset-Datei handlich bleibt).

import type { ParamValue } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { getEngine } from '../render/runtime';
import type { Project } from '../state/project';

export const THUMB_EDGE = 96;

export async function imageDataUrl(img: ImageData): Promise<string> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D-Kontext nicht verfügbar');
  // auf Weiß (JPEG ohne Transparenz)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, img.height);
  const tmp = new OffscreenCanvas(img.width, img.height);
  tmp.getContext('2d')?.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      resolve(typeof r.result === 'string' ? r.result : '');
    };
    r.onerror = () => {
      reject(r.error ?? new Error('Lesen fehlgeschlagen'));
    };
    r.readAsDataURL(blob);
  });
}

/** Effekt mit diesen Werten auf der ersten Ebene des Projekts. */
export async function effectPresetThumbnail(
  project: Project,
  effectId: string,
  values: Record<string, ParamValue>,
): Promise<ImageData | null> {
  const engine = getEngine();
  const plugin = getPlugin(effectId);
  if (!engine || !plugin) return null;
  return engine.effectThumbnail(project, plugin, THUMB_EDGE, values);
}

/** Aktuelles Bild einer Ebene oder Gruppe (mit ihren Effekten). */
export async function nodeThumbnail(project: Project, nodeId: string): Promise<ImageData | null> {
  const engine = getEngine();
  if (!engine) return null;
  return (await engine.nodeThumbnails(project, [nodeId], THUMB_EDGE)).get(nodeId) ?? null;
}
