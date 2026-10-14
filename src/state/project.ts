// Datenmodell nach SPEC „Datenmodell“. Unveränderliche Daten: alle Funktionen liefern neue Objekte
// (strukturelles Teilen), damit History-Snapshots billig sind.

import type { ParamValue } from '../effects/manifest';

export const PROJECT_FORMAT_VERSION = 1;

export type BlendMode =
  'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'lighten' | 'darken' | 'difference';

export type OriginalRef = { id: string; fileName: string; mimeType: string; width: number; height: number };

/** Phase 1: nur "full" (keine Maske). Gespeicherte Masken folgen in Phase 2. */
export type MaskRef = { kind: 'full' } | { kind: 'stored'; id: string; version: number; bits: 8 | 16 };

export type EffectRegion = 'whole' | 'focus-weighted' | 'inverse-focus';

export type EffectInstance = {
  instanceId: string;
  effectId: string;
  effectVersion: string;
  enabled: boolean;
  /** 0..1, Mischung mit dem Eingang */
  strength: number;
  params: Record<string, ParamValue>;
  region: EffectRegion;
};

export type Transform = { x: number; y: number; scale: number; rotation: number };

export type Layer = {
  kind: 'layer';
  id: string;
  name: string;
  originalId: string;
  mask: MaskRef;
  maskSource: 'auto' | 'depth' | 'brush' | 'full';
  depth?: number;
  transform: Transform;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  effects: EffectInstance[];
};

export type Group = {
  kind: 'group';
  id: string;
  name: string;
  /** Index 0 = ganz hinten */
  children: SceneNode[];
  editMode: 'group' | 'individual';
  effects: EffectInstance[];
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
};

/** Heißt in der Spec "Node" (kollidiert mit dem DOM-Typ). */
export type SceneNode = Layer | Group;

export type Project = {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvas: { width: number; height: number; background: string };
  originals: Record<string, OriginalRef>;
  root: Group;
};

export const newId = (): string => crypto.randomUUID();

export function createProjectFromImage(original: OriginalRef, name?: string): Project {
  const now = new Date().toISOString();
  const layer: Layer = {
    kind: 'layer',
    id: newId(),
    name: original.fileName.replace(/\.[^.]+$/, ''),
    originalId: original.id,
    mask: { kind: 'full' },
    maskSource: 'full',
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    effects: [],
  };
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: newId(),
    name: name ?? layer.name,
    createdAt: now,
    updatedAt: now,
    canvas: { width: original.width, height: original.height, background: 'transparent' },
    originals: { [original.id]: original },
    root: {
      kind: 'group',
      id: newId(),
      name: 'Bild',
      children: [layer],
      editMode: 'individual',
      effects: [],
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    },
  };
}

// ---------- Baum-Hilfen ----------

export function findNode(root: Group, id: string): SceneNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    if (c.id === id) return c;
    if (c.kind === 'group') {
      const f = findNode(c, id);
      if (f) return f;
    }
  }
  return undefined;
}

export function* walk(node: SceneNode): Generator<SceneNode> {
  yield node;
  if (node.kind === 'group') for (const c of node.children) yield* walk(c);
}

function mapNode(node: SceneNode, id: string, fn: (n: SceneNode) => SceneNode): SceneNode {
  if (node.id === id) return fn(node);
  if (node.kind !== 'group') return node;
  const children = node.children.map((c) => mapNode(c, id, fn));
  return children.some((c, i) => c !== node.children[i]) ? { ...node, children } : node;
}

export function updateNode(project: Project, id: string, fn: (n: SceneNode) => SceneNode): Project {
  const root = mapNode(project.root, id, fn);
  if (root === project.root) return project;
  if (root.kind !== 'group') throw new Error('Wurzel muss eine Gruppe sein');
  return { ...project, root };
}

// ---------- Effekt-Stack ----------

function updateEffects(
  project: Project,
  nodeId: string,
  fn: (e: EffectInstance[]) => EffectInstance[],
): Project {
  return updateNode(project, nodeId, (n) => ({ ...n, effects: fn(n.effects) }));
}

export function addEffect(project: Project, nodeId: string, effect: EffectInstance, index?: number): Project {
  return updateEffects(project, nodeId, (list) => {
    const i = index ?? list.length;
    return [...list.slice(0, i), effect, ...list.slice(i)];
  });
}

export function removeEffect(project: Project, nodeId: string, instanceId: string): Project {
  return updateEffects(project, nodeId, (list) => list.filter((e) => e.instanceId !== instanceId));
}

/** Verschiebt einen Effekt an Position toIndex (bezogen auf die Liste ohne das Element). */
export function moveEffect(project: Project, nodeId: string, instanceId: string, toIndex: number): Project {
  return updateEffects(project, nodeId, (list) => {
    const item = list.find((e) => e.instanceId === instanceId);
    if (!item) return list;
    const rest = list.filter((e) => e !== item);
    const i = Math.max(0, Math.min(rest.length, toIndex));
    return [...rest.slice(0, i), item, ...rest.slice(i)];
  });
}

export function updateEffect(
  project: Project,
  nodeId: string,
  instanceId: string,
  patch: Partial<Omit<EffectInstance, 'instanceId' | 'effectId'>>,
): Project {
  return updateEffects(project, nodeId, (list) =>
    list.map((e) => (e.instanceId === instanceId ? { ...e, ...patch } : e)),
  );
}

export function setEffectParams(
  project: Project,
  nodeId: string,
  instanceId: string,
  values: Record<string, ParamValue>,
): Project {
  return updateEffects(project, nodeId, (list) =>
    list.map((e) => (e.instanceId === instanceId ? { ...e, params: { ...e.params, ...values } } : e)),
  );
}

/** Erste sichtbare Ebene (für die Auswahl beim Öffnen). */
export function firstLayer(project: Project): Layer | undefined {
  for (const n of walk(project.root)) if (n.kind === 'layer') return n;
  return undefined;
}
