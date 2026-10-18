// Tiefenebenen (Spec d): Tiefenkarte berechnen und eine Ebene in N Tiefenbänder aufteilen.

import { defaultParams, type ParamValue } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { encodeMaskPng, type MaskData } from '../io/maskCodec';
import { loadOriginal, saveDepth } from '../io/storage';
import { getEngine } from '../render/runtime';
import { commit } from '../state/commands';
import {
  findNode,
  newId,
  replaceNode,
  type DepthMapRef,
  type EffectInstance,
  type Group,
  type DepthBandMask,
  type Layer,
  type LicenseMode,
  type Project,
} from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { backendsFor } from './backend';
import { presetValues, type DepthPreset } from './depthBands';
import type { Progress } from './protocol';
import { INFERENCE_MAX_EDGE, startTask } from './split';

/** Ergebnis einer Tiefenschätzung: Referenz (gespeichert, auf der GPU) + verkleinerte Werte für Histogramm/Vorschau. */
export type DepthResult = {
  ref: DepthMapRef;
  preview: { data: Float32Array; width: number; height: number };
  ms: number;
};

const PREVIEW_EDGE = 512;
const cache = new Map<string, DepthResult>();

function downsample(full: MaskData): { data: Float32Array; width: number; height: number } {
  const s = Math.min(1, PREVIEW_EDGE / Math.max(full.width, full.height));
  const w = Math.max(1, Math.round(full.width * s));
  const h = Math.max(1, Math.round(full.height * s));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(full.width - 1, Math.floor(((x + 0.5) * full.width) / w));
      const sy = Math.min(full.height - 1, Math.floor(((y + 0.5) * full.height) / h));
      out[y * w + x] = (full.data[sy * full.width + sx] ?? 0) / 65535;
    }
  return { data: out, width: w, height: h };
}

/** Berechnet (oder liefert aus dem Sitzungs-Cache) die Tiefenkarte eines Originals. */
export async function computeDepth(
  project: Project,
  originalId: string,
  family: string,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<DepthResult> {
  const key = `${originalId}|${family}`;
  const cached = cache.get(key);
  const engine = getEngine();
  if (cached && engine?.sources.hasMask(cached.ref.id)) return cached;
  const o = project.originals[originalId];
  const f = await loadOriginal(originalId);
  if (!engine || !o || !f) throw new Error('Original fehlt.');
  const blob = new Blob([f], { type: o.mimeType });
  const t0 = performance.now();
  const preview = () => {
    const s = Math.min(1, INFERENCE_MAX_EDGE / Math.max(o.width, o.height));
    return createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(o.width * s)),
      resizeHeight: Math.max(1, Math.round(o.height * s)),
      resizeQuality: 'high',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
    });
  };
  let lastError: unknown = null;
  for (const backend of backendsFor(family, licenseMode, 'depth')) {
    try {
      const r = await backend.estimateDepth(family, { preview, original: blob }, licenseMode, onProgress);
      let full: MaskData;
      if (r.mask.data instanceof Float32Array) {
        full = await engine.refineMask(originalId, {
          data: r.mask.data,
          width: r.mask.width,
          height: r.mask.height,
        });
      } else if (r.mask.width !== o.width || r.mask.height !== o.height) {
        const fl = Float32Array.from(r.mask.data, (v) => v / 65535);
        full = await engine.refineMask(originalId, { data: fl, width: r.mask.width, height: r.mask.height });
      } else full = r.mask as MaskData;
      const id = newId();
      await saveDepth(id, encodeMaskPng(full));
      engine.sources.addMask(id, full.width, full.height, full.data);
      const result: DepthResult = {
        ref: {
          id,
          width: full.width,
          height: full.height,
          provenance: {
            modelId: r.model.id,
            commercialUse: r.model.commercialUse,
            createdAt: new Date().toISOString(),
          },
        },
        preview: downsample(full),
        ms: performance.now() - t0,
      };
      cache.set(key, result);
      return result;
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
  throw lastError instanceof Error ? lastError : new Error('Keine Tiefenschätzung möglich.');
}

export type DepthSplitOptions = {
  /** [0, b1, …, 1] – n+1 Werte für n Ebenen */
  boundaries: number[];
  /** Ebenen-Überlappung in Leinwand-px (0…64) */
  overlap: number;
  preset: DepthPreset;
  maxBlur: number;
  maxHaze: number;
};

function effect(effectId: string, params: Record<string, ParamValue>): EffectInstance[] {
  const manifest = getPlugin(effectId)?.manifest;
  if (!manifest) return [];
  return [
    {
      instanceId: newId(),
      effectId,
      effectVersion: manifest.version,
      enabled: true,
      strength: 1,
      params: { ...defaultParams(manifest), ...params },
      region: 'whole',
    },
  ];
}

/**
 * Baut die Gruppe „Tiefenebenen“: hinten die fernste Ebene (deckend, Lochfüllung für alles Nähere),
 * davor die Bänder bis zur nächsten Ebene; jede Ebene füllt Inhalte näherer Ebenen auf.
 */
export function buildDepthGroup(layer: Layer, depth: DepthMapRef, o: DepthSplitOptions): Group {
  const b = o.boundaries;
  const n = b.length - 1;
  const {
    shadow: _s,
    focusMap: _f,
    selection: _sel,
    maskStrokes: _strokes,
    holeMask: _hole,
    initial: _initial,
    ...base
  } = layer;
  const children: Layer[] = [];
  // Rang: 0 = nächste Ebene … n−1 = fernste; Kinder-Index 0 = ganz hinten = fernste
  for (let rank = n - 1; rank >= 0; rank--) {
    const near = b[rank] ?? 0;
    const far = b[rank + 1] ?? 1;
    const farthest = rank === n - 1;
    const v = presetValues(o.preset, rank, n, o.maxBlur, o.maxHaze);
    // Jede Ebene erhält die Preset-Effekte (auch mit 0), damit der Gruppenmodus alle Ebenen erreicht.
    const effects = [
      ...(o.preset !== 'none' ? effect('gaussian-blur', { radius: v.blur }) : []),
      ...(o.preset === 'atmosphere' ? effect('haze', { amount: v.haze }) : []),
    ];
    const mask: DepthBandMask = {
      kind: 'depth',
      depthId: depth.id,
      // fernste Ebene deckt alles ab (keine Lücken), die übrigen ihr Band
      near: farthest ? 0 : near,
      far,
      overlap: o.overlap,
      fillBelow: near,
    };
    children.push({
      ...base,
      id: newId(),
      name: rank === 0 ? 'Ebene 1 (nah)' : farthest ? `Ebene ${rank + 1} (fern)` : `Ebene ${rank + 1}`,
      maskSource: 'depth',
      mask,
      holeFill: rank > 0,
      initial: { mask, maskEdge: base.maskEdge, holeFill: rank > 0 },
      depthMap: depth,
      depth: (near + far) / 2,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      effects,
    });
  }
  return {
    kind: 'group',
    id: newId(),
    name: 'Tiefenebenen',
    children: [{ ...layer, visible: false, name: `${layer.name} (Original)` }, ...children],
    editMode: 'individual',
    effects: [],
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    visible: true,
    origin: { kind: 'depth-split', sourceLayerId: layer.id },
  };
}

/** Komplettablauf: Ebene durch die Gruppe „Tiefenebenen“ ersetzen. */
export function splitDepth(layerId: string, depth: DepthResult, options: DepthSplitOptions): boolean {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  if (node?.kind !== 'layer') return false;
  const group = buildDepthGroup(node, depth.ref, options);
  commit(`Aufgeteilt: ${options.boundaries.length - 1} Tiefenebenen`, (p) => replaceNode(p, layerId, group));
  useAppStore.getState().select(group.id);
  useAppStore.getState().notify('info', `In ${options.boundaries.length - 1} Tiefenebenen aufgeteilt.`);
  return true;
}

/** Tiefenkarte im Dialog berechnen (mit Fortschritt in der unteren Leiste). */
export async function depthForDialog(layerId: string, family: string): Promise<DepthResult | null> {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  const { notify, licenseMode } = useAppStore.getState();
  if (!project || node?.kind !== 'layer') return null;
  const task = startTask('Tiefe berechnen');
  try {
    return await computeDepth(project, node.originalId, family, licenseMode, task.progress);
  } catch (e) {
    notify('error', `Tiefe: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    task.done();
  }
}
