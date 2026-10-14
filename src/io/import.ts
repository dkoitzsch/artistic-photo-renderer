import { getRenderer } from '../render/runtime';
import { useAppStore } from '../state/store';
import { fitToViewport } from '../state/viewActions';
import { sha256Hex } from './hash';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

/** Ab dieser Größe nur Hinweis: Export und Performance-Ziele sind auf 24 MP ausgelegt. */
const MAX_TARGET_PIXELS = 24_000_000;

function isAccepted(file: File): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(file.type);
}

function isHeic(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** Lädt eine Bilddatei als Original. Gibt false zurück, wenn sie abgelehnt wurde (Hinweis im UI). */
export async function importImageFile(file: File): Promise<boolean> {
  const { notify, setImage, gpu } = useAppStore.getState();
  const renderer = getRenderer();
  if (!renderer || gpu.state !== 'ready') {
    notify('error', 'Bild kann nicht geladen werden: WebGPU ist nicht verfügbar.');
    return false;
  }
  if (isHeic(file)) {
    notify(
      'error',
      `${file.name}: HEIC wird von Chrome nicht dekodiert. Bitte als JPEG oder PNG exportieren.`,
    );
    return false;
  }
  if (!isAccepted(file)) {
    notify('error', `${file.name}: Format nicht unterstützt (JPEG, PNG oder WebP).`);
    return false;
  }

  let bitmap: ImageBitmap;
  const bytes = await file.arrayBuffer();
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
    });
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

  const originalId = await sha256Hex(bytes);
  renderer.setImage(bitmap);
  bitmap.close();
  setImage({ originalId, fileName: file.name, width, height });
  fitToViewport();

  if (width * height > MAX_TARGET_PIXELS) {
    notify(
      'info',
      `${file.name} hat ${((width * height) / 1e6).toFixed(1)} MP; ausgelegt ist die App auf 24 MP.`,
    );
  } else {
    notify('info', `${file.name} geladen (${width} × ${height} px).`);
  }
  return true;
}
