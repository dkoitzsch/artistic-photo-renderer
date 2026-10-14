// Alle Projektänderungen laufen hier durch: benannte Befehle → History (Undo/Redo).

import { defaultParams, type ParamValue } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { jump, push, redo, sealCoalescing, undo } from './history';
import {
  addEffect,
  findNode,
  firstLayer,
  moveEffect,
  newId,
  removeEffect,
  setEffectParams,
  updateEffect,
  type EffectInstance,
  type Project,
} from './project';
import { getProject, newHistory, useAppStore } from './store';

/** Wendet eine Änderung an. Gleicher coalesceKey innerhalb einer Geste → ein History-Eintrag. */
export function commit(label: string, fn: (p: Project) => Project, coalesceKey?: string): void {
  const { history, setHistory } = useAppStore.getState();
  if (!history) return;
  const current = history.entries[history.index]?.state;
  if (!current) return;
  const next = fn(current);
  if (next === current) return;
  setHistory(push(history, label, { ...next, updatedAt: new Date().toISOString() }, coalesceKey));
}

/** Beendet eine Geste (z. B. Regler losgelassen). */
export function endGesture(): void {
  const { history, setHistory } = useAppStore.getState();
  if (history) setHistory(sealCoalescing(history));
}

export function undoCommand(): void {
  const { history, setHistory } = useAppStore.getState();
  if (history) setHistory(undo(history));
}

export function redoCommand(): void {
  const { history, setHistory } = useAppStore.getState();
  if (history) setHistory(redo(history));
}

export function jumpToHistory(index: number): void {
  const { history, setHistory } = useAppStore.getState();
  if (history) setHistory(jump(history, index));
}

/** Öffnet ein Projekt mit neuer History und wählt die erste Ebene. */
export function openProject(project: Project, label = 'Geöffnet'): void {
  const s = useAppStore.getState();
  s.setHistory(newHistory(project, label));
  s.select(firstLayer(project)?.id ?? project.root.id);
  s.setScreen('editor');
  s.setCompareSplit(null);
}

export function closeProject(): void {
  const s = useAppStore.getState();
  s.setHistory(null);
  s.select(null);
}

/** Ausgewählter Knoten, sonst die Wurzelgruppe. */
export function targetNodeId(): string | null {
  const p = getProject();
  if (!p) return null;
  const id = useAppStore.getState().selectedNodeId;
  return id && findNode(p.root, id) ? id : p.root.id;
}

export function renameProject(name: string): void {
  commit('Projekt umbenannt', (p) => ({ ...p, name }), 'rename');
}

export function addEffectCommand(effectId: string, nodeId = targetNodeId()): string | null {
  const plugin = getPlugin(effectId);
  if (!plugin?.manifest || !nodeId) return null;
  const instance: EffectInstance = {
    instanceId: newId(),
    effectId,
    effectVersion: plugin.manifest.version,
    enabled: true,
    strength: 1,
    params: defaultParams(plugin.manifest),
    region: 'whole',
  };
  commit(`Effekt hinzugefügt: ${plugin.manifest.name}`, (p) => addEffect(p, nodeId, instance));
  return instance.instanceId;
}

const effectName = (fx: EffectInstance) => getPlugin(fx.effectId)?.manifest?.name ?? fx.effectId;

function findEffect(p: Project, nodeId: string, instanceId: string): EffectInstance | undefined {
  return findNode(p.root, nodeId)?.effects.find((e) => e.instanceId === instanceId);
}

export function removeEffectCommand(nodeId: string, instanceId: string): void {
  const p = getProject();
  const fx = p ? findEffect(p, nodeId, instanceId) : undefined;
  commit(`Effekt entfernt: ${fx ? effectName(fx) : ''}`, (p) => removeEffect(p, nodeId, instanceId));
}

export function moveEffectCommand(nodeId: string, instanceId: string, toIndex: number): void {
  commit('Effekt verschoben', (p) => moveEffect(p, nodeId, instanceId, toIndex));
}

export function setEffectEnabledCommand(nodeId: string, instanceId: string, enabled: boolean): void {
  commit(enabled ? 'Effekt eingeschaltet' : 'Effekt ausgeschaltet', (p) =>
    updateEffect(p, nodeId, instanceId, { enabled }),
  );
}

/** Parameteränderung; gesture = true fasst Reglerbewegungen zusammen. */
export function setParamCommand(
  nodeId: string,
  instanceId: string,
  key: string,
  value: ParamValue,
  gesture: boolean,
): void {
  const p = getProject();
  const fx = p ? findEffect(p, nodeId, instanceId) : undefined;
  const label = fx ? getPlugin(fx.effectId)?.manifest?.params.find((x) => x.key === key)?.label : undefined;
  commit(
    `${label ?? key} geändert`,
    (proj) => setEffectParams(proj, nodeId, instanceId, { [key]: value }),
    gesture ? `param:${instanceId}:${key}` : undefined,
  );
  if (!gesture) endGesture();
}

export function setStrengthCommand(
  nodeId: string,
  instanceId: string,
  strength: number,
  gesture: boolean,
): void {
  commit(
    'Stärke geändert',
    (p) => updateEffect(p, nodeId, instanceId, { strength }),
    gesture ? `strength:${instanceId}` : undefined,
  );
  if (!gesture) endGesture();
}

export function applyPresetCommand(
  nodeId: string,
  instanceId: string,
  name: string,
  values: Record<string, ParamValue>,
): void {
  commit(`Preset: ${name}`, (p) => setEffectParams(p, nodeId, instanceId, values));
}

export function resetEffectCommand(nodeId: string, instanceId: string): void {
  const p = getProject();
  const fx = p ? findEffect(p, nodeId, instanceId) : undefined;
  const manifest = fx ? getPlugin(fx.effectId)?.manifest : undefined;
  if (!manifest) return;
  commit(`Zurückgesetzt: ${manifest.name}`, (proj) =>
    updateEffect(proj, nodeId, instanceId, { params: defaultParams(manifest), strength: 1 }),
  );
}
