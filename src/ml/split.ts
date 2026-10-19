// Aufteilen in Vorder- und Hintergrund (Spec b): Maske → Gruppe „Motiv“ mit Vordergrund, Hintergrund (Lochfüllung)
// und dem ausgeblendeten Ursprungs-Layer. Optional Fokuspunkte aus Face/Pose-Landmarkern.

import { defaultParams } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { encodeMaskPng, type MaskData } from '../io/maskCodec';
import { loadOriginal, saveMask } from '../io/storage';
import { getEngine } from '../render/runtime';
import { commit } from '../state/commands';
import {
  findNode,
  newId,
  replaceNode,
  walk,
  walkLayers,
  type EffectInstance,
  type FocusMapSpec,
  type Group,
  type Layer,
  type LicenseMode,
  type MaskRef,
  type Project,
  type Provenance,
} from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { backendsFor, detectLandmarks } from './backend';
import { focusPointsFromLandmarks } from './focus';
import type { Progress } from './protocol';
import { modelById, type ModelEntry } from './registry';

/** Eingabekopie für Browser-Modelle: max. 1024 px lange Kante (Spec: Laufzeit). */
export const INFERENCE_MAX_EDGE = 1024;

let nextTaskId = 1;

function progressText(p: Progress): string {
  if (p.stage === 'download')
    return `${p.label}: Download ${(p.loaded / 1e6).toFixed(0)} / ${(p.total / 1e6).toFixed(0)} MB`;
  if (p.stage === 'load') return `${p.label}: wird geladen …`;
  return `${p.label}: wird berechnet …`;
}

/** Fortschritt einer ML-Aufgabe in der unteren Leiste. */
export function startTask(label: string) {
  const id = nextTaskId++;
  const { upsertTask, removeTask } = useAppStore.getState();
  upsertTask({ id, label, detail: '', progress: null });
  return {
    progress: (p: Progress) => {
      upsertTask({ id, label, detail: progressText(p), progress: p.total > 0 ? p.loaded / p.total : null });
    },
    done: () => {
      removeTask(id);
    },
  };
}

async function originalBlob(project: Project, originalId: string): Promise<Blob> {
  const o = project.originals[originalId];
  const f = await loadOriginal(originalId);
  if (!o || !f) throw new Error('Original fehlt im lokalen Speicher.');
  return new Blob([f], { type: o.mimeType });
}

function previewBitmap(blob: Blob, width: number, height: number): Promise<ImageBitmap> {
  const s = Math.min(1, INFERENCE_MAX_EDGE / Math.max(width, height));
  return createImageBitmap(blob, {
    resizeWidth: Math.max(1, Math.round(width * s)),
    resizeHeight: Math.max(1, Math.round(height * s)),
    resizeQuality: 'high',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default',
  });
}

function provenance(model: ModelEntry): Provenance {
  return { modelId: model.id, commercialUse: model.commercialUse, createdAt: new Date().toISOString() };
}

/**
 * Berechnet eine Vordergrundmaske in voller Auflösung, speichert sie (16 Bit) und lädt sie auf die GPU.
 * Im ML-Modus „Auto“ wird bei Dienstfehlern ohne Abbruch auf das Browser-Modell gewechselt.
 */
export async function computeForegroundMask(
  project: Project,
  originalId: string,
  family: string,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<{ id: string; width: number; height: number; model: ModelEntry; ms: number }> {
  const engine = getEngine();
  const o = project.originals[originalId];
  if (!engine || !o) throw new Error('Kein Bild geladen.');
  const blob = await originalBlob(project, originalId);
  const t0 = performance.now();
  let lastError: unknown = null;
  for (const backend of backendsFor(family, licenseMode)) {
    try {
      const r = await backend.segmentForeground(
        family,
        { preview: () => previewBitmap(blob, o.width, o.height), original: blob },
        licenseMode,
        onProgress,
      );
      let full: MaskData;
      if (r.mask.data instanceof Float32Array) {
        full = await engine.refineMask(originalId, {
          data: r.mask.data,
          width: r.mask.width,
          height: r.mask.height,
        });
      } else if (r.mask.width !== o.width || r.mask.height !== o.height) {
        const f = new Float32Array(r.mask.data.length);
        for (let i = 0; i < f.length; i++) f[i] = (r.mask.data[i] ?? 0) / 65535;
        full = await engine.refineMask(originalId, { data: f, width: r.mask.width, height: r.mask.height });
      } else {
        full = r.mask as MaskData;
      }
      const id = newId();
      await saveMask(id, encodeMaskPng(full));
      engine.sources.addMask(id, full.width, full.height, full.data);
      return { id, width: full.width, height: full.height, model: r.model, ms: performance.now() - t0 };
    } catch (e) {
      lastError = e;
      if (backend.runtime === 'service' && useAppStore.getState().mlMode === 'auto') {
        useAppStore
          .getState()
          .notify(
            'info',
            `Dienst nicht verfügbar (${e instanceof Error ? e.message : String(e)}) – Browser-Modell wird verwendet.`,
          );
        continue;
      }
      throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Keine Segmentierung möglich.');
}

/** Fokuspunkte für ein Original (Ebenen-px = Pixel des Originals). */
export async function computeFocusPoints(
  project: Project,
  originalId: string,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<FocusMapSpec> {
  const o = project.originals[originalId];
  if (!o) throw new Error('Original fehlt.');
  const blob = await originalBlob(project, originalId);
  const lm = await detectLandmarks(await previewBitmap(blob, o.width, o.height), licenseMode, onProgress);
  const face = modelById('mediapipe-face-landmarker');
  return {
    // Fokuspunkte liegen in Ebenen-px (Pixel des Originals)
    points: focusPointsFromLandmarks(lm, o.width, o.height, newId),
    ...(face ? { provenance: provenance(face) } : {}),
  };
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

/** Ersetzt die Ebene durch die Gruppe „Motiv“ (Ursprung ausgeblendet, Hintergrund, Vordergrund). */
export function buildSplitGroup(
  layer: Layer,
  mask: Omit<Extract<MaskRef, { kind: 'stored' }>, 'inverted'>,
  focus?: FocusMapSpec,
): Group {
  const {
    shadow: _shadow,
    focusMap: _focus,
    selection: _sel,
    maskStrokes: _strokes,
    holeMask: _hole,
    initial: _initial,
    ...rest
  } = layer;
  const base = { ...rest, maskSource: 'auto' as const };
  const background: Layer = {
    ...base,
    id: newId(),
    name: 'Hintergrund',
    mask: { ...mask, inverted: true },
    holeFill: true,
    initial: { mask: { ...mask, inverted: true }, maskEdge: layer.maskEdge, holeFill: true },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    effects: blurInstance(60),
  };
  const foreground: Layer = {
    ...base,
    id: newId(),
    name: 'Vordergrund',
    mask: { ...mask, inverted: false },
    holeFill: false,
    initial: { mask: { ...mask, inverted: false }, maskEdge: layer.maskEdge, holeFill: false },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    effects: blurInstance(10),
    ...(focus?.points.length ? { focusMap: focus } : {}),
  };
  return {
    kind: 'group',
    id: newId(),
    name: 'Motiv',
    children: [{ ...layer, visible: false, name: `${layer.name} (Original)` }, background, foreground],
    editMode: 'individual',
    effects: [],
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    visible: true,
    origin: { kind: 'auto-fg-bg', sourceLayerId: layer.id },
  };
}

/** Komplettablauf „Aufteilen: Vordergrund/Hintergrund“. */
export async function splitForeground(
  layerId: string,
  family: string,
  withLandmarks: boolean,
): Promise<boolean> {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  const { notify, licenseMode, select } = useAppStore.getState();
  if (!project || node?.kind !== 'layer') return false;
  const task = startTask(`Aufteilen: ${node.name}`);
  try {
    const [mask, focus] = await Promise.all([
      computeForegroundMask(project, node.originalId, family, licenseMode, task.progress),
      withLandmarks
        ? computeFocusPoints(project, node.originalId, licenseMode, task.progress).catch((e: unknown) => {
            notify('info', `Keine Fokuspunkte: ${e instanceof Error ? e.message : String(e)}`);
            return undefined;
          })
        : Promise.resolve(undefined),
    ]);
    const group = buildSplitGroup(
      node,
      {
        kind: 'stored',
        id: mask.id,
        width: mask.width,
        height: mask.height,
        provenance: provenance(mask.model),
      },
      focus,
    );
    commit('Aufgeteilt: Vordergrund/Hintergrund', (p) => replaceNode(p, layerId, group));
    const fg = group.children[2];
    if (fg) select(fg.id);
    notify(
      'info',
      `Aufgeteilt mit ${mask.model.name} (${mask.model.runtime === 'service' ? 'Dienst' : 'Browser'}, ${(mask.ms / 1000).toFixed(1)} s)` +
        (focus ? `, ${focus.points.length} Fokuspunkte` : ''),
    );
    return true;
  } catch (e) {
    notify('error', `Aufteilen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    task.done();
  }
}

/** Fokuspunkte für eine vorhandene Ebene neu erkennen. */
export async function detectFocusForLayer(layerId: string): Promise<void> {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  const { notify, licenseMode } = useAppStore.getState();
  if (!project || node?.kind !== 'layer') return;
  const task = startTask('Fokuspunkte erkennen');
  try {
    const focus = await computeFocusPoints(project, node.originalId, licenseMode, task.progress);
    commit('Fokuspunkte erkannt', (p) => replaceNode(p, layerId, { ...node, focusMap: focus }));
    notify(
      'info',
      focus.points.length ? `${focus.points.length} Fokuspunkte erkannt.` : 'Keine Person erkannt.',
    );
  } catch (e) {
    notify('error', `Fokuspunkte: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    task.done();
  }
}

/** Ebenen, deren Ergebnis von einem nur nicht-kommerziell nutzbaren Modell stammt. */
export function ncLayers(project: Project): { id: string; name: string; modelId: string }[] {
  const out: { id: string; name: string; modelId: string }[] = [];
  for (const l of walkLayers(project.root)) {
    if (!l.visible) continue;
    if (l.mask.kind === 'stored' && !l.mask.provenance.commercialUse)
      out.push({ id: l.id, name: l.name, modelId: l.mask.provenance.modelId });
    else if (l.focusMap?.provenance && !l.focusMap.provenance.commercialUse)
      out.push({ id: l.id, name: l.name, modelId: l.focusMap.provenance.modelId });
    else if (l.depthMap && !l.depthMap.provenance.commercialUse)
      out.push({ id: l.id, name: l.name, modelId: l.depthMap.provenance.modelId });
  }
  // Analysekarten aus NC-Modellen (z. B. Tiefe aus Depth Anything Large), soweit Ebenen dieses Original zeigen
  for (const [originalId, maps] of Object.entries(project.analysis ?? {}))
    for (const ref of [maps.depth, maps.saliency, maps.faces]) {
      if (!ref || ref.provenance.commercialUse) continue;
      const l = [...walkLayers(project.root)].find((x) => x.visible && x.originalId === originalId);
      if (l) out.push({ id: l.id, name: `${l.name} – Analysekarte`, modelId: ref.provenance.modelId });
    }
  // Effekte, deren Verfahren/Modelle nur nicht-kommerziell nutzbar sind (Manifest license.commercialUse = false)
  for (const n of walk(project.root)) {
    if (!n.visible) continue;
    for (const fx of n.effects) {
      const m = getPlugin(fx.effectId)?.manifest;
      if (fx.enabled && m && !m.license.commercialUse)
        out.push({ id: n.id, name: `${n.name} – ${m.name}`, modelId: `Effekt ${fx.effectId}` });
    }
  }
  return out;
}

/** Ersetzt alle NC-Masken durch Masken eines kommerziell nutzbaren Modells (BiRefNet). */
export async function recomputeWithCommercialModels(): Promise<boolean> {
  const project = getProject();
  const { notify } = useAppStore.getState();
  if (!project) return false;
  const jobs = new Map<string, string>(); // alte Masken-ID → Original
  for (const l of walkLayers(project.root))
    if (l.mask.kind === 'stored' && !l.mask.provenance.commercialUse) jobs.set(l.mask.id, l.originalId);
  if (!jobs.size) return true;
  const task = startTask('Mit kommerziellen Modellen neu berechnen');
  try {
    const replacements = new Map<string, Extract<MaskRef, { kind: 'stored' }>>();
    for (const [oldId, originalId] of jobs) {
      const m = await computeForegroundMask(project, originalId, 'birefnet', 'commercial', task.progress);
      replacements.set(oldId, {
        kind: 'stored',
        id: m.id,
        width: m.width,
        height: m.height,
        inverted: false,
        provenance: provenance(m.model),
      });
    }
    commit('Masken mit kommerziellen Modellen neu berechnet', (p) => {
      let next = p;
      for (const l of walkLayers(p.root)) {
        if (l.mask.kind !== 'stored') continue;
        const rep = replacements.get(l.mask.id);
        if (rep) next = replaceNode(next, l.id, { ...l, mask: { ...rep, inverted: l.mask.inverted } });
      }
      return next;
    });
    notify('info', `${jobs.size} Maske(n) mit BiRefNet neu berechnet.`);
    return true;
  } catch (e) {
    notify('error', `Neuberechnung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    task.done();
  }
}
