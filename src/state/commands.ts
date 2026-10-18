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
  setEffectMask,
  setGroupMask,
  updateEffect,
  updateHost,
  updateLayer,
  updateNode,
  parentOf,
  setParamInGroup,
  setStrengthInGroup,
  moveNode,
  wrapNodesInGroup,
  ungroup,
  findNode,
  insertAbove,
  moveToEdge,
  removeNode,
  stepNode,
  walkLayers,
  type BlendMode,
  type BrushStroke,
  type Layer,
  type OriginalRef,
  type Transform,
  type EffectInstance,
  type EffectMask,
  type FocusMapSpec,
  type FocusPoint,
  type LicenseMode,
  type MaskEdge,
  type Project,
} from './project';
import { getProject, newHistory, useAppStore } from './store';
import { instancesFrom, type StackPreset } from '../presets/model';
import { normalizeMalplan, type MalplanSettings } from '../malplan/model';

/**
 * Läuft gerade eine Regler-Geste (Ziehen)? Dient dem Compositor dazu, teure asynchrone Effekte
 * (Browser-CPU/Dienst) erst beim Loslassen neu zu berechnen statt bei jedem Zwischenwert.
 */
let gestureActive = false;
export function isGestureActive(): boolean {
  return gestureActive;
}

/** Wendet eine Änderung an. Gleicher coalesceKey innerhalb einer Geste → ein History-Eintrag. */
export function commit(label: string, fn: (p: Project) => Project, coalesceKey?: string): void {
  const { history, setHistory } = useAppStore.getState();
  if (!history) return;
  const current = history.entries[history.index]?.state;
  if (!current) return;
  const next = fn(current);
  if (next === current) return;
  if (coalesceKey !== undefined) gestureActive = true;
  setHistory(push(history, label, { ...next, updatedAt: new Date().toISOString() }, coalesceKey));
}

/** Beendet eine Geste (z. B. Regler losgelassen): History-Einträge versiegeln, einmal neu rendern. */
export function endGesture(): void {
  gestureActive = false;
  const { history, setHistory, bumpRenderTick } = useAppStore.getState();
  if (history) setHistory(sealCoalescing(history));
  bumpRenderTick();
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

/** Malplan-Einstellungen ändern (Teilobjekt wird flach übernommen); gesture fasst Reglerbewegungen zusammen. */
export function setMalplanCommand(
  patch: Partial<MalplanSettings>,
  gesture = false,
  label = 'Malplan geändert',
): void {
  commit(
    label,
    (p) => ({ ...p, malplan: { ...normalizeMalplan(p.malplan, p.canvas), ...patch } }),
    gesture ? `malplan:${Object.keys(patch).join(',')}` : undefined,
  );
  if (!gesture) endGesture();
}

export function addEffectCommand(effectId: string, nodeId = targetNodeId()): string | null {
  const plugin = getPlugin(effectId);
  if (!plugin?.manifest || !nodeId) return null;
  if (!plugin.manifest.license.commercialUse && useAppStore.getState().licenseMode === 'commercial') {
    useAppStore
      .getState()
      .notify(
        'error',
        `${plugin.manifest.name} ist nur nicht-kommerziell nutzbar – im Lizenzmodus „Alle“ verfügbar.`,
      );
    return null;
  }
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

export function setEffectBlendCommand(nodeId: string, instanceId: string, blendMode: BlendMode): void {
  commit('Mischmodus des Effekts geändert', (p) => updateEffect(p, nodeId, instanceId, { blendMode }));
}

/** Eigene Maske eines Effekts setzen/ändern/entfernen; gesture fasst Reglerbewegungen zusammen. */
export function setEffectMaskCommand(
  nodeId: string,
  instanceId: string,
  mask: EffectMask | undefined,
  gesture = false,
): void {
  commit(
    mask ? 'Effektmaske geändert' : 'Effektmaske entfernt',
    (p) => setEffectMask(p, nodeId, instanceId, mask),
    gesture ? `effect-mask:${instanceId}` : undefined,
  );
  if (!gesture) endGesture();
}

/** Maske einer Gruppe setzen/ändern/entfernen. */
export function setGroupMaskCommand(groupId: string, mask: EffectMask | undefined, gesture = false): void {
  commit(
    mask ? 'Gruppenmaske geändert' : 'Gruppenmaske entfernt',
    (p) => setGroupMask(p, groupId, mask),
    gesture ? `group-mask:${groupId}` : undefined,
  );
  if (!gesture) endGesture();
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
  // Gruppenmodus: Änderung auch in alle Geschwister mit diesem Effekt schreiben (außer entkoppelte)
  const parent = p ? parentOf(p.root, nodeId) : undefined;
  const target = parent?.editMode === 'group' && fx ? { groupId: parent.id, effectId: fx.effectId } : null;
  commit(
    `${label ?? key} geändert${target ? ' (Gruppe)' : ''}`,
    (proj) => {
      const next = setEffectParams(proj, nodeId, instanceId, { [key]: value });
      return target ? setParamInGroup(next, target.groupId, target.effectId, key, value, nodeId) : next;
    },
    gesture ? `param:${instanceId}:${key}` : undefined,
  );
  if (!gesture) endGesture();
}

/** Gemeinsame Bearbeitung in der Gruppe: Parameter in alle Kinder mit diesem Effekt schreiben. */
export function setGroupParamCommand(
  groupId: string,
  effectId: string,
  key: string,
  value: ParamValue,
  gesture: boolean,
): void {
  const label = getPlugin(effectId)?.manifest?.params.find((x) => x.key === key)?.label ?? key;
  commit(
    `${label} geändert (Gruppe)`,
    (p) => setParamInGroup(p, groupId, effectId, key, value),
    gesture ? `group:${groupId}:${effectId}:${key}` : undefined,
  );
  if (!gesture) endGesture();
}

export function setGroupStrengthCommand(
  groupId: string,
  effectId: string,
  strength: number,
  gesture: boolean,
): void {
  commit(
    'Mischung geändert (Gruppe)',
    (p) => setStrengthInGroup(p, groupId, effectId, strength),
    gesture ? `group:${groupId}:${effectId}:strength` : undefined,
  );
  if (!gesture) endGesture();
}

export function setEditModeCommand(groupId: string, editMode: 'group' | 'individual'): void {
  commit(editMode === 'group' ? 'Bearbeitung: Gruppe' : 'Bearbeitung: Einzeln', (p) =>
    updateNode(p, groupId, (n) => (n.kind === 'group' ? { ...n, editMode } : n)),
  );
}

/** Parameter eines Effekts von der Gruppenbearbeitung entkoppeln bzw. wieder koppeln (Schloss). */
export function toggleDecoupledCommand(nodeId: string, instanceId: string, key: string): void {
  const p = getProject();
  const fx = p ? findEffect(p, nodeId, instanceId) : undefined;
  if (!fx) return;
  const on = !(fx.decoupled ?? []).includes(key);
  const decoupled = on ? [...(fx.decoupled ?? []), key] : (fx.decoupled ?? []).filter((k) => k !== key);
  commit(on ? 'Parameter entkoppelt' : 'Parameter gekoppelt', (proj) =>
    updateEffect(proj, nodeId, instanceId, { decoupled }),
  );
}

export function setStrengthCommand(
  nodeId: string,
  instanceId: string,
  strength: number,
  gesture: boolean,
): void {
  const p0 = getProject();
  const fx = p0 ? findEffect(p0, nodeId, instanceId) : undefined;
  const parent = p0 ? parentOf(p0.root, nodeId) : undefined;
  const target = parent?.editMode === 'group' && fx ? { groupId: parent.id, effectId: fx.effectId } : null;
  commit(
    'Stärke geändert',
    (p) => {
      const next = updateEffect(p, nodeId, instanceId, { strength });
      return target ? setStrengthInGroup(next, target.groupId, target.effectId, strength, nodeId) : next;
    },
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

// ---------- Pinsel (Basis-Spec g) ----------

export type PaintTarget = 'selection' | 'mask' | 'focus';

/** Striche einer Ebene für ein Pinselziel. */
export function strokesOf(layer: Layer, target: PaintTarget): BrushStroke[] {
  if (target === 'mask') return layer.maskStrokes ?? [];
  if (target === 'focus') return layer.focusMap?.strokes ?? [];
  return layer.selection?.strokes ?? [];
}

function withStrokes(layer: Layer, target: PaintTarget, strokes: BrushStroke[]): Layer {
  if (target === 'mask') return { ...layer, maskStrokes: strokes };
  if (target === 'focus') return { ...layer, focusMap: { points: [], ...layer.focusMap, strokes } };
  return { ...layer, selection: { base: layer.selection?.base ?? { kind: 'empty' }, strokes } };
}

let activeStroke: { id: number; layerId: string; target: PaintTarget } | null = null;
let nextStrokeId = 1;

/** Neue Strich-ID für einen Pinselzug (alle Aktualisierungen dieses Zugs ersetzen denselben Strich). */
export function beginStroke(): number {
  return nextStrokeId++;
}

const PAINT_LABEL: Record<PaintTarget, string> = {
  selection: 'Markierung gemalt',
  mask: 'Maske gemalt',
  focus: 'Fokuskarte gemalt',
};

/**
 * Pinselstrich setzen bzw. während des Malens aktualisieren (gleiche strokeId ersetzt den letzten Strich).
 * gesture = true: läuft noch (ein History-Eintrag je Zug).
 */
export function paintStrokeCommand(
  layerId: string,
  target: PaintTarget,
  stroke: BrushStroke,
  strokeId: number,
  gesture: boolean,
): void {
  const same =
    activeStroke?.id === strokeId && activeStroke.layerId === layerId && activeStroke.target === target;
  commit(
    PAINT_LABEL[target],
    (p) =>
      updateLayer(p, layerId, (l) => {
        const list = strokesOf(l, target);
        const next = same ? [...list.slice(0, -1), stroke] : [...list, stroke];
        return { ...withStrokes(l, target, next), maskSource: target === 'mask' ? 'brush' : l.maskSource };
      }),
    gesture ? `paint:${strokeId}` : undefined,
  );
  activeStroke = { id: strokeId, layerId, target };
  if (!gesture) {
    activeStroke = null;
    endGesture();
  }
}

/** Alle Striche eines Ziels entfernen (Markierung: auch die Grundauswahl). */
export function clearPaintCommand(layerId: string, target: PaintTarget): void {
  commit(target === 'selection' ? 'Markierung gelöscht' : 'Striche entfernt', (p) =>
    updateLayer(p, layerId, (l) => {
      if (target === 'selection') {
        const { selection: _s, ...rest } = l;
        return rest;
      }
      return withStrokes(l, target, []);
    }),
  );
}

/** Markierung auf die ganze Ebene setzen. */
export function selectAllCommand(layerId: string): void {
  commit('Alles markiert', (p) =>
    updateLayer(p, layerId, (l) => ({ ...l, selection: { base: { kind: 'full' }, strokes: [] } })),
  );
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

// ---------- Ebenenliste: umsortieren, gruppieren ----------

export function moveNodeCommand(nodeId: string, targetGroupId: string, index: number): void {
  commit('Ebene verschoben', (p) => moveNode(p, nodeId, targetGroupId, index));
}

export function groupNodeCommand(nodeId: string): void {
  groupNodesCommand([nodeId]);
}

/** Fasst die Knoten (Geschwister) in einer neuen Gruppe zusammen und wählt sie aus. */
export function groupNodesCommand(nodeIds: string[]): void {
  let groupId = '';
  commit(nodeIds.length > 1 ? `${nodeIds.length} Ebenen gruppiert` : 'Gruppiert', (p) => {
    const r = wrapNodesInGroup(p, nodeIds);
    groupId = r.groupId;
    return r.project;
  });
  if (groupId) {
    useAppStore.getState().select(groupId);
    useAppStore.getState().setExtraSelection([]);
  }
}

export function ungroupCommand(groupId: string): void {
  const p = getProject();
  const first = p ? findNode(p.root, groupId) : undefined;
  commit('Gruppe aufgelöst', (proj) => ungroup(proj, groupId));
  if (first?.kind === 'group' && first.children.at(-1))
    useAppStore.getState().select(first.children.at(-1)?.id ?? null);
}

// ---------- Phase 4: weitere Bilder, Transform, Reihenfolge ----------

/** Nimmt ein Original ins Projekt auf, ohne eine Ebene anzulegen (z. B. Zweitbild eines Effekts). */
export function addOriginalCommand(original: OriginalRef): void {
  commit(`Bild „${original.fileName}“ hinzugefügt`, (p) =>
    p.originals[original.id] ? p : { ...p, originals: { ...p.originals, [original.id]: original } },
  );
}

/** Fügt eine Ebene (mit neuem Original) über der Auswahl ein und wählt sie aus. */
export function addLayerCommand(original: OriginalRef, layer: Layer): void {
  const selected = useAppStore.getState().selectedNodeId;
  commit(`Ebene „${layer.name}“ hinzugefügt`, (p) =>
    insertAbove({ ...p, originals: { ...p.originals, [original.id]: original } }, layer, selected),
  );
  useAppStore.getState().select(layer.id);
}

export function deleteNodeCommand(nodeId: string): void {
  const p = getProject();
  const node = p ? findNode(p.root, nodeId) : undefined;
  if (!p || !node || nodeId === p.root.id) return;
  const parent = parentOf(p.root, nodeId);
  commit(`„${node.name}“ gelöscht`, (proj) => removeNode(proj, nodeId));
  // Auswahl: Nachbar in derselben Gruppe, sonst die Gruppe
  const siblings = parent?.children.filter((c) => c.id !== nodeId) ?? [];
  const i = parent?.children.findIndex((c) => c.id === nodeId) ?? 0;
  const next = siblings[Math.min(Math.max(0, i - 1), siblings.length - 1)];
  useAppStore.getState().select(next?.id ?? parent?.id ?? null);
}

export function setTransformCommand(layerId: string, patch: Partial<Transform>, gesture: boolean): void {
  commit(
    'Transformiert',
    (p) => updateLayer(p, layerId, (l) => (l.locked ? l : { ...l, transform: { ...l.transform, ...patch } })),
    gesture ? `transform:${layerId}` : undefined,
  );
  if (!gesture) endGesture();
}

/** Verschiebt eine Ebene oder alle Ebenen einer Gruppe um (dx, dy) Leinwand-px. */
export function translateNodeCommand(nodeId: string, dx: number, dy: number, gesture: boolean): void {
  commit(
    'Verschoben',
    (p) => {
      const node = findNode(p.root, nodeId);
      if (!node) return p;
      let next = p;
      for (const l of node.kind === 'layer' ? [node] : walkLayers(node))
        if (!l.locked)
          next = updateLayer(next, l.id, (x) => ({
            ...x,
            transform: { ...x.transform, x: x.transform.x + dx, y: x.transform.y + dy },
          }));
      return next;
    },
    gesture ? `translate:${nodeId}` : undefined,
  );
  if (!gesture) endGesture();
}

/** Ausgewählten Knoten eine Ebene nach vorn (1) oder hinten (−1). */
export function stepNodeCommand(dir: 1 | -1): void {
  const id = useAppStore.getState().selectedNodeId;
  if (id) commit(dir === 1 ? 'Eine Ebene nach vorn' : 'Eine Ebene nach hinten', (p) => stepNode(p, id, dir));
}

/** Ausgewählten Knoten ganz nach vorn (1) oder hinten (−1). */
export function edgeNodeCommand(dir: 1 | -1): void {
  const id = useAppStore.getState().selectedNodeId;
  if (id) commit(dir === 1 ? 'Ganz nach vorn' : 'Ganz nach hinten', (p) => moveToEdge(p, id, dir));
}

// ---------- Presets ----------

/** Stapel-Preset auf einen Effekt-Träger anwenden: ersetzen oder anhängen (ein Undo-Schritt). */
export function applyStackPresetCommand(
  nodeId: string,
  preset: StackPreset,
  mode: 'replace' | 'append',
): void {
  commit(`Stapel-Preset „${preset.name}“ ${mode === 'replace' ? 'angewendet' : 'angehängt'}`, (p) =>
    updateHost(p, nodeId, (h) => {
      const added = instancesFrom(preset.effects, newId);
      return { ...h, effects: mode === 'replace' ? added : [...h.effects, ...added] };
    }),
  );
}
