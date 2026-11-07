// Inpainting-Lochfüllung mit LaMa (Dienst, Spec Phase 6): Quellbild und Lochmaske der Ebene gehen an POST /inpaint; das
// Ergebnis wird als Original im Projekt gespeichert und ersetzt die schnelle Füllung aus der Umgebung im Lochbereich.

import { registerOriginalFromBlob } from '../io/import';
import { getEngine } from '../render/runtime';
import { clearInpaintCommand, setInpaintCommand } from '../state/commands';
import { findNode } from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { startTask } from './split';
import { assertAllowed, modelById } from './registry';
import { serviceInpaint } from './serviceBackend';

export const INPAINT_MODEL_ID = 'lama';
/** Lange Kante des an den Dienst gesendeten Ausschnitts (LaMa rechnet intern mit 512 × 512 px je Lochbereich). */
const INPAINT_MAX_EDGE = 1024;

async function canvasPng(
  draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
  w: number,
  h: number,
): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D-Kontext nicht verfügbar.');
  draw(ctx);
  return c.convertToBlob({ type: 'image/png' });
}

/** Kann der Dienst gerade inpainten (online, Modell geladen, Lizenzmodus erlaubt)? Sonst Begründung. */
export function inpaintAvailability(): { ok: true } | { ok: false; reason: string } {
  const { service, licenseMode, mlMode } = useAppStore.getState();
  const model = modelById(INPAINT_MODEL_ID);
  if (!model) return { ok: false, reason: 'LaMa ist nicht im Modellregister.' };
  if (mlMode === 'browser') return { ok: false, reason: 'ML-Modus „Browser“: LaMa läuft nur im Dienst.' };
  if (service.state !== 'online') return { ok: false, reason: 'Der ML-Dienst ist nicht erreichbar.' };
  if (!model.commercialUse && licenseMode !== 'all')
    return { ok: false, reason: 'Im Lizenzmodus „Kommerziell“ gesperrt.' };
  const entry = service.info?.models.find((m) => m.id === INPAINT_MODEL_ID);
  if (!entry?.available)
    return {
      ok: false,
      reason: entry?.note ?? 'LaMa ist im Dienst nicht heruntergeladen (Dialog „Modelle“).',
    };
  return { ok: true };
}

/** Füllt das Loch der Ebene mit LaMa; ein Verlaufseintrag. Fehler werden gemeldet, nichts wird verändert. */
export async function inpaintLayer(layerId: string): Promise<boolean> {
  const { notify, licenseMode } = useAppStore.getState();
  const project = getProject();
  const engine = getEngine();
  const model = modelById(INPAINT_MODEL_ID);
  if (!project || !engine || !model) return false;
  const avail = inpaintAvailability();
  if (!avail.ok) {
    notify('error', `Lochfüllung mit LaMa: ${avail.reason}`);
    return false;
  }
  const layer = findNode(project.root, layerId);
  if (layer?.kind !== 'layer') return false;
  const task = startTask('Lochfüllung (LaMa)');
  try {
    assertAllowed(model, licenseMode);
    const req = await engine.inpaintRequest(project, layerId, INPAINT_MAX_EDGE);
    if (!req) {
      notify('info', 'Diese Ebene hat keinen ausgeblendeten Bereich, der aufgefüllt werden könnte.');
      return false;
    }
    const { width, height } = req;
    const image = await canvasPng(
      (ctx) => {
        ctx.putImageData(new ImageData(req.image, width, height), 0, 0);
      },
      width,
      height,
    );
    const mask = await canvasPng(
      (ctx) => {
        const px = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < req.mask.length; i++) {
          const v = req.mask[i] ?? 0;
          px[i * 4] = v;
          px[i * 4 + 1] = v;
          px[i * 4 + 2] = v;
          px[i * 4 + 3] = 255;
        }
        ctx.putImageData(new ImageData(px, width, height), 0, 0);
      },
      width,
      height,
    );
    const result = await serviceInpaint(model, image, mask, licenseMode, task.progress);
    const original = await registerOriginalFromBlob(result, `Lochfüllung ${layer.name}.png`);
    setInpaintCommand(layerId, original, {
      modelId: model.id,
      commercialUse: model.commercialUse,
      createdAt: new Date().toISOString(),
    });
    notify('info', `Lochfüllung mit LaMa fertig (${width} × ${height} px).`);
    return true;
  } catch (e) {
    notify('error', `Lochfüllung mit LaMa fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    task.done();
  }
}

export { clearInpaintCommand };
