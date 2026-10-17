// Nur im Dev-Server: Zugriff für Tests und Fehlersuche über window.__bls.

import { usePluginStore } from './effects/pluginStore';
import { exportSettings, renderPng } from './io/export';
import { encodeMaskPng } from './io/maskCodec';
import { saveMask } from './io/storage';
import { detectLandmarks } from './ml/backend';
import { browserDepth } from './ml/browserBackend';
import { modelById } from './ml/registry';
import * as split from './ml/split';
import { getEngine } from './render/runtime';
import { presetsSaved, usePresetStore } from './presets/store';
import * as commands from './state/commands';
import { findNode, newId, replaceNode } from './state/project';
import { getProject, useAppStore } from './state/store';

/** Teilt eine Ebene mit einer vorgegebenen Maske auf (für Tests ohne ML-Modell). */
async function splitWithMask(
  layerId: string,
  data: Uint16Array,
  width: number,
  height: number,
): Promise<string> {
  const project = getProject();
  const node = project ? findNode(project.root, layerId) : undefined;
  if (node?.kind !== 'layer') throw new Error('keine Ebene');
  const id = newId();
  await saveMask(id, encodeMaskPng({ width, height, data }));
  getEngine()?.sources.addMask(id, width, height, data);
  const group = split.buildSplitGroup(node, {
    kind: 'stored',
    id,
    width,
    height,
    provenance: { modelId: 'test-mask', commercialUse: true, createdAt: new Date().toISOString() },
  });
  commands.commit('Test-Aufteilung', (p) => replaceNode(p, layerId, group));
  return group.id;
}

export function installDebugApi(): void {
  (window as unknown as { __bls: unknown }).__bls = {
    store: useAppStore,
    plugins: usePluginStore,
    commands,
    getProject,
    getEngine,
    exportSettings,
    renderPng,
    ml: { detectLandmarks, split, splitWithMask, browserDepth, modelById },
    presets: { store: usePresetStore, saved: presetsSaved },
  };
}
