// Alle Projektänderungen laufen hier durch: benannte Befehle → History (Undo/Redo).

import { defaultParams, type ParamValue } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { jump, push, redo, sealCoalescing, undo } from './history';
import {
  addEffect,
  findHost,
  firstLayer,
  moveEffect,
  newId,
  removeEffect,
  setEffectParams,
  updateEffect,
  updateHost,
  updateLayer,
  type BlendMode,
  type EffectInstance,
  type FocusMapSpec,
  type FocusPoint,
  type LicenseMode,
  type MaskEdge,
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
  return id && findHost(p.root, id) ? id : p.root.id;
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
  return findHost(p.root, nodeId)?.host.effects.find((e) => e.instanceId === instanceId);
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

// ---------- Phase 2: Ebenen, Masken, Fokus, Schatten ----------

export function setNodeOpacityCommand(nodeId: string, opacity: number, gesture: boolean): void {
  commit(
    'Deckkraft geändert',
    (p) => updateHost(p, nodeId, (n) => ({ ...n, opacity })),
    gesture ? `opacity:${nodeId}` : undefined,
  );
  if (!gesture) endGesture();
}

export function setNodeBlendCommand(nodeId: string, blendMode: BlendMode): void {
  commit('Mischmodus geändert', (p) => updateHost(p, nodeId, (n) => ({ ...n, blendMode })));
}

export function setNodeVisibleCommand(nodeId: string, visible: boolean): void {
  commit(visible ? 'Eingeblendet' : 'Ausgeblendet', (p) => updateHost(p, nodeId, (n) => ({ ...n, visible })));
}

export function setMaskEdgeCommand(layerId: string, patch: Partial<MaskEdge>, gesture: boolean): void {
  commit(
    'Kantenübergang geändert',
    (p) => updateLayer(p, layerId, (l) => ({ ...l, maskEdge: { ...l.maskEdge, ...patch } })),
    gesture ? `edge:${layerId}:${Object.keys(patch).join()}` : undefined,
  );
  if (!gesture) endGesture();
}

export function setHoleFillCommand(layerId: string, holeFill: boolean): void {
  commit(holeFill ? 'Lochfüllung ein' : 'Lochfüllung aus', (p) =>
    updateLayer(p, layerId, (l) => ({ ...l, holeFill })),
  );
}

export function setFocusMapCommand(layerId: string, focusMap: FocusMapSpec | undefined, label: string): void {
  commit(label, (p) =>
    updateLayer(p, layerId, (l) => {
      if (focusMap) return { ...l, focusMap };
      const { focusMap: _drop, ...rest } = l;
      return rest;
    }),
  );
}

export function updateFocusPointCommand(
  layerId: string,
  pointId: string,
  patch: Partial<FocusPoint>,
  gesture: boolean,
): void {
  commit(
    'Fokuspunkt geändert',
    (p) =>
      updateLayer(p, layerId, (l) =>
        l.focusMap
          ? {
              ...l,
              focusMap: {
                ...l.focusMap,
                points: l.focusMap.points.map((pt) => (pt.id === pointId ? { ...pt, ...patch } : pt)),
              },
            }
          : l,
      ),
    gesture ? `focus:${pointId}:${Object.keys(patch).join()}` : undefined,
  );
  if (!gesture) endGesture();
}

export function addFocusPointCommand(layerId: string, point: FocusPoint): void {
  commit('Fokuspunkt hinzugefügt', (p) =>
    updateLayer(p, layerId, (l) => ({
      ...l,
      focusMap: { ...(l.focusMap ?? { points: [] }), points: [...(l.focusMap?.points ?? []), point] },
    })),
  );
}

export function removeFocusPointCommand(layerId: string, pointId: string): void {
  commit('Fokuspunkt entfernt', (p) =>
    updateLayer(p, layerId, (l) =>
      l.focusMap
        ? { ...l, focusMap: { ...l.focusMap, points: l.focusMap.points.filter((pt) => pt.id !== pointId) } }
        : l,
    ),
  );
}

/** Schatten-Layer anlegen (mit Standardwerten des Plugins „shadow“) oder entfernen. */
export function setShadowCommand(layerId: string, enabled: boolean): void {
  const manifest = getPlugin('shadow')?.manifest;
  if (enabled && !manifest) {
    useAppStore.getState().notify('error', 'Das Schatten-Plugin ist nicht verfügbar.');
    return;
  }
  commit(enabled ? 'Schatten hinzugefügt' : 'Schatten entfernt', (p) =>
    updateLayer(p, layerId, (l) => {
      if (!enabled) {
        const { shadow: _drop, ...rest } = l;
        return rest;
      }
      if (l.shadow || !manifest) return l;
      return {
        ...l,
        shadow: {
          id: newId(),
          visible: true,
          opacity: 0.65,
          blendMode: 'multiply',
          effectVersion: manifest.version,
          params: defaultParams(manifest),
          effects: [],
        },
      };
    }),
  );
}

export function setShadowParamCommand(
  layerId: string,
  key: string,
  value: ParamValue,
  gesture: boolean,
): void {
  commit(
    'Schatten geändert',
    (p) =>
      updateLayer(p, layerId, (l) =>
        l.shadow ? { ...l, shadow: { ...l.shadow, params: { ...l.shadow.params, [key]: value } } } : l,
      ),
    gesture ? `shadow:${layerId}:${key}` : undefined,
  );
  if (!gesture) endGesture();
}

export function setLicenseModeOfProject(mode: LicenseMode): void {
  commit(mode === 'all' ? 'Lizenzmodus: Alle' : 'Lizenzmodus: Kommerziell', (p) => ({
    ...p,
    licenseMode: mode,
  }));
}
