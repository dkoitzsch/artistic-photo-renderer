// Aufteilen Modus 3 „Objekte“ (Basis-Spec): automatische Instanzmasken (SAM 2.1); jedes größere Objekt wird eine eigene
// Ebene in der Gruppe „Objekte“, der Rest ist der Hintergrund mit Lochfüllung. Im Dienst läuft SAM 2.1 Large
// (POST /segment/objects), sonst SAM 2.1 Tiny im Browser (Punktraster, gleiche Auswahlregeln).

import { defaultParams } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { encodeMaskPng } from '../io/maskCodec';
import { loadOriginal, saveMask } from '../io/storage';
import { getEngine } from '../render/runtime';
import { commit } from '../state/commands';
import {
  findNode,
  newId,
  replaceNode,
  type EffectInstance,
  type Group,
  type Layer,
  type MaskRef,
  type Provenance,
} from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { browserSamObjects } from './browserBackend';
import { modelById, type ModelEntry } from './registry';
import { serviceObjects } from './serviceBackend';
import { startTask } from './split';

export const SAM_BROWSER_ID = 'sam2.1-tiny';
export const SAM_SERVICE_ID = 'sam2.1-large';

export type ObjectsResult = {
  labels: Uint16Array;
  width: number;
  height: number;
  objects: { label: number; score: number; area: number }[];
  model: ModelEntry;
};

/** Nimmt den Dienst, wenn er online ist und SAM Large geladen hat (Modus „Auto“/„Dienst“); sonst Browser. */
function pickRuntime(): 'service' | 'browser' {
  const { mlMode, service, licenseMode } = useAppStore.getState();
  if (mlMode === 'browser') return 'browser';
  const m = modelById(SAM_SERVICE_ID);
  const ok =
    service.state === 'online' &&
    !!m &&
    (m.commercialUse || licenseMode === 'all') &&
    (service.info?.models.some((x) => x.id === m.id && x.available) ?? false);
  if (mlMode === 'service' && !ok)
    throw new Error('SAM 2.1 Large ist im Dienst nicht verfügbar (Dialog „Modelle“: herunterladen).');
  return ok ? 'service' : 'browser';
}

/** Objekte eines Originals finden (Etikettenkarte + Liste). */
export async function findObjects(
  originalId: string,
  maxObjects: number,
  onProgress: Parameters<typeof browserSamObjects>[6],
): Promise<ObjectsResult> {
  const project = getProject();
  const o = project?.originals[originalId];
  const f = await loadOriginal(originalId);
  if (!o || !f) throw new Error('Original fehlt im lokalen Speicher.');
  const blob = new Blob([f], { type: o.mimeType });
  const { licenseMode } = useAppStore.getState();
  if (pickRuntime() === 'service') {
    const model = modelById(SAM_SERVICE_ID);
    if (!model) throw new Error('SAM 2.1 Large fehlt im Modellregister.');
    const r = await serviceObjects(model, blob, licenseMode, maxObjects, 16, onProgress);
    return { ...r, model };
  }
  const model = modelById(SAM_BROWSER_ID);
  if (!model) throw new Error('SAM 2.1 Tiny fehlt im Modellregister.');
  const size = model.input?.size ?? 1024;
  const r = await browserSamObjects(
    model,
    originalId,
    () =>
      createImageBitmap(blob, {
        resizeWidth: size,
        resizeHeight: size,
        resizeQuality: 'high',
        premultiplyAlpha: 'none',
      }),
    8,
    maxObjects,
    licenseMode,
    onProgress,
  );
  return { ...r, model };
}

function blurInstance(radius: number): EffectInstance[] {
  const manifest = getPlugin('gaussian-blur')?.manifest;
  if (!manifest) return [];
  return [
    {
      instanceId: newId(),
      effectId: 'gaussian-blur',
      effectVersion: manifest.version,
      enabled: true,
      strength: 1,
      params: { ...defaultParams(manifest), radius },
      region: 'whole',
    },
  ];
}

/** Ersetzt die Ebene durch die Gruppe „Objekte“: Ursprung (ausgeblendet), Hintergrund, je ein Objekt (große zuerst). */
export function buildObjectsGroup(
  layer: Layer,
  background: Omit<Extract<MaskRef, { kind: 'stored' }>, 'inverted'>,
  objects: { name: string; mask: Omit<Extract<MaskRef, { kind: 'stored' }>, 'inverted'> }[],
): Group {
  const {
    shadow: _shadow,
    focusMap: _focus,
    selection: _sel,
    maskStrokes: _strokes,
    holeMask: _hole,
    initial: _initial,
    inpaint: _inpaint,
    ...rest
  } = layer;
  const base = { ...rest, maskSource: 'auto' as const };
  const bgMask: MaskRef = { ...background, inverted: true };
  const bg: Layer = {
    ...base,
    id: newId(),
    name: 'Hintergrund',
    mask: bgMask,
    holeFill: true,
    initial: { mask: bgMask, maskEdge: layer.maskEdge, holeFill: true },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    effects: blurInstance(60),
  };
  const layers: Layer[] = objects.map((ob) => {
    const mask: MaskRef = { ...ob.mask, inverted: false };
    return {
      ...base,
      id: newId(),
      name: ob.name,
      mask,
      holeFill: false,
      initial: { mask, maskEdge: layer.maskEdge, holeFill: false },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      effects: blurInstance(8),
    };
  });
  return {
    kind: 'group',
    id: newId(),
    name: 'Objekte',
    children: [{ ...layer, visible: false, name: `${layer.name} (Original)` }, bg, ...layers],
    editMode: 'individual',
    effects: [],
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    visible: true,
    origin: { kind: 'sam-objects', sourceLayerId: layer.id },
  };
}

/** Speichert eine Maske (aus einer groben Wahrscheinlichkeitskarte) in voller Auflösung und lädt sie auf die GPU. */
async function storeMask(
  originalId: string,
  coarse: Float32Array,
  width: number,
  height: number,
  provenance: Provenance,
): Promise<Omit<Extract<MaskRef, { kind: 'stored' }>, 'inverted'>> {
  const engine = getEngine();
  if (!engine) throw new Error('GPU-Engine nicht bereit.');
  const full = await engine.refineMask(originalId, { data: coarse, width, height });
  const id = newId();
  await saveMask(id, encodeMaskPng(full));
  engine.sources.addMask(id, full.width, full.height, full.data);
  return { kind: 'stored', id, width: full.width, height: full.height, provenance };
}

/** Komplettablauf „Aufteilen: Objekte“. Liefert die Zahl der gefundenen Objekte (0 = nichts verändert). */
export async function splitObjects(layerId: string, maxObjects = 6): Promise<number> {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  const { notify, select } = useAppStore.getState();
  if (!project || node?.kind !== 'layer') return 0;
  const task = startTask(`Objekte: ${node.name}`);
  try {
    const r = await findObjects(node.originalId, maxObjects, task.progress);
    if (r.objects.length === 0) {
      notify('info', 'Keine Objekte gefunden – das Bild bleibt unverändert.');
      return 0;
    }
    const n = r.width * r.height;
    const provenance: Provenance = {
      modelId: r.model.id,
      commercialUse: r.model.commercialUse,
      createdAt: new Date().toISOString(),
    };
    const objects: { name: string; mask: Awaited<ReturnType<typeof storeMask>> }[] = [];
    for (const ob of r.objects) {
      const m = new Float32Array(n);
      for (let i = 0; i < n; i++) m[i] = r.labels[i] === ob.label ? 1 : 0;
      objects.push({
        name: `Objekt ${ob.label}`,
        mask: await storeMask(node.originalId, m, r.width, r.height, provenance),
      });
    }
    const union = new Float32Array(n);
    for (let i = 0; i < n; i++) union[i] = (r.labels[i] ?? 0) > 0 ? 1 : 0;
    const background = await storeMask(node.originalId, union, r.width, r.height, provenance);
    const group = buildObjectsGroup(node, background, objects);
    commit('Aufgeteilt: Objekte', (p) => replaceNode(p, layerId, group));
    const first = group.children[2];
    if (first) select(first.id);
    notify(
      'info',
      `${r.objects.length} Objekte gefunden (${r.model.name}, ${r.model.runtime === 'service' ? 'Dienst' : 'Browser'}).`,
    );
    return r.objects.length;
  } catch (e) {
    notify('error', `Objekte aufteilen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  } finally {
    task.done();
  }
}
