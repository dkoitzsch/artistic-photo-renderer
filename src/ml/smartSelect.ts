// Smarte Auswahl (Basis-Spec g): Klicks auf ein Objekt → SAM 2.1 im Browser → Maske (Guided Filter auf volle
// Auflösung) → Grundlage der Markierung der Ebene. Weitere Klicks verfeinern (Alt-Klick = gehört nicht dazu).

import { encodeMaskPng } from '../io/maskCodec';
import { loadOriginal, saveMask } from '../io/storage';
import { getEngine } from '../render/runtime';
import { setSelectionCommand } from '../state/commands';
import { findNode, newId } from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { browserSam } from './browserBackend';
import { modelById } from './registry';
import { startTask } from './split';

export const SAM_MODEL_ID = 'sam2.1-tiny';

let busy: Promise<void> | null = null;

/** Läuft gerade eine Auswahl? (UI zeigt einen Hinweis und nimmt keine neuen Klicks an) */
export function smartSelectBusy(): boolean {
  return busy !== null;
}

/**
 * Fügt einen Klick hinzu (Ebenen-px; positive = gehört dazu) und berechnet die Markierung neu.
 * reset: vorherige Klicks verwerfen (neues Objekt).
 */
export async function smartSelectClick(
  layerId: string,
  x: number,
  y: number,
  positive: boolean,
  reset = false,
): Promise<void> {
  if (busy) return busy;
  busy = run(layerId, x, y, positive, reset).finally(() => {
    busy = null;
  });
  return busy;
}

async function run(layerId: string, x: number, y: number, positive: boolean, reset: boolean): Promise<void> {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  const engine = getEngine();
  if (!project || node?.kind !== 'layer' || !engine) return;
  const o = project.originals[node.originalId];
  const model = modelById(SAM_MODEL_ID);
  if (!o || !model) throw new Error('Smarte Auswahl nicht verfügbar.');
  const clicks = [
    ...(reset ? [] : (node.selection?.clicks ?? [])),
    Math.round(x),
    Math.round(y),
    positive ? 1 : 0,
  ];
  const points: [number, number, number][] = [];
  for (let i = 0; i < clicks.length; i += 3)
    points.push([(clicks[i] ?? 0) / o.width, (clicks[i + 1] ?? 0) / o.height, clicks[i + 2] ?? 1]);
  const task = startTask('Smarte Auswahl');
  try {
    const { licenseMode } = useAppStore.getState();
    const r = await browserSam(
      model,
      node.originalId,
      async () => {
        const f = await loadOriginal(node.originalId);
        if (!f) throw new Error('Original fehlt im lokalen Speicher.');
        const size = model.input?.size ?? 1024;
        return createImageBitmap(new Blob([f], { type: o.mimeType }), {
          resizeWidth: size,
          resizeHeight: size,
          resizeQuality: 'high',
          premultiplyAlpha: 'none',
        });
      },
      points,
      licenseMode,
      task.progress,
    );
    const full = await engine.refineMask(node.originalId, { data: r.mask, width: r.width, height: r.height });
    const id = newId();
    await saveMask(id, encodeMaskPng(full));
    engine.sources.addMask(id, full.width, full.height, full.data);
    setSelectionCommand(
      layerId,
      {
        kind: 'stored',
        id,
        width: full.width,
        height: full.height,
        inverted: false,
        provenance: {
          modelId: model.id,
          commercialUse: model.commercialUse,
          createdAt: new Date().toISOString(),
        },
      },
      clicks,
      positive ? 'Smarte Auswahl' : 'Smarte Auswahl (ausgenommen)',
    );
  } catch (e) {
    useAppStore.getState().notify('error', `Smarte Auswahl: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    task.done();
  }
}
