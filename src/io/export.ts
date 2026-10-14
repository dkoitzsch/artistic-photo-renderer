import { getRenderer } from '../render/runtime';
import { useAppStore } from '../state/store';

/** Rendert die Komposition in voller Auflösung und kodiert sie als PNG (sRGB). */
export async function renderPng(): Promise<Blob> {
  const renderer = getRenderer();
  const size = renderer?.imageSize;
  if (!renderer || !size) throw new Error('Kein Bild geladen.');

  const region = renderer.renderRegion({ x: 0, y: 0, ...size });
  const pixels = await renderer.encodeToSrgb8(region);
  region.destroy();

  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('2D-Kontext für den Export nicht verfügbar.');
  ctx.putImageData(new ImageData(pixels, size.width, size.height, { colorSpace: 'srgb' }), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'export';
}

/** Exportiert das aktuelle Bild als PNG-Download. */
export async function exportPng(): Promise<void> {
  const { image, notify } = useAppStore.getState();
  if (!image) {
    notify('error', 'Nichts zu exportieren: Es ist kein Bild geladen.');
    return;
  }
  try {
    const blob = await renderPng();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName(image.fileName)}.png`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10_000);
    notify('info', `Exportiert: ${a.download}`);
  } catch (e) {
    notify('error', `Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
}
