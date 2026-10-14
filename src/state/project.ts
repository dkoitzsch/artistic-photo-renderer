// Datenmodell nach SPEC „Datenmodell“. Unveränderliche Daten: alle Funktionen liefern neue Objekte
// (strukturelles Teilen), damit History-Snapshots billig sind.

import type { ParamValue } from '../effects/manifest';

export const PROJECT_FORMAT_VERSION = 2;

export type BlendMode =
  'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'lighten' | 'darken' | 'difference';

export type OriginalRef = { id: string; fileName: string; mimeType: string; width: number; height: number };

export type LicenseMode = 'commercial' | 'all';

/** Herkunft eines ML-Ergebnisses (Maske, Fokuspunkte, …) – für Lizenz-Badges und Export-Warnung. */
export type Provenance = { modelId: string; commercialUse: boolean; createdAt: string };

/**
 * Maske einer Ebene. "stored": unveränderliche 16-Bit-Maske im Speicher (masks/<id>.png), Größe = Original.
 * inverted: Ebene nutzt 1 − Maske (z. B. Hintergrund).
 */
export type MaskRef =
  | { kind: 'full' }
  | { kind: 'stored'; id: string; width: number; height: number; inverted: boolean; provenance: Provenance };

/** Kantenübergang (Kern-Stufe, siehe DECISIONS.md). */
export type MaskEdge = {
  /** 0 = binär mit Antialiasing … 100 = bis 150 px weich */
  hardness: number;
  /** −30 … +30 px: schrumpfen / erweitern */
  offset: number;
  curve: 'linear' | 'smooth' | 'steep';
};

export const DEFAULT_MASK_EDGE: MaskEdge = { hardness: 4, offset: 0, curve: 'linear' };

export type FocusPointKind = 'eye' | 'face' | 'chest' | 'hand' | 'custom';

export type FocusPoint = {
  id: string;
  kind: FocusPointKind;
  label: string;
  /** Leinwand-px (volle Auflösung) */
  x: number;
  y: number;
  radius: number;
  enabled: boolean;
};

export type FocusMapSpec = { points: FocusPoint[]; provenance?: Provenance };

/** Verknüpfter Schatten-Layer direkt unter seiner Ebene; Bild erzeugt das Plugin "shadow". */
export type ShadowLayer = {
  id: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  effectVersion: string;
  params: Record<string, ParamValue>;
  /** eigener Effekt-Stack des Schattens */
  effects: EffectInstance[];
};

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
  maskEdge: MaskEdge;
  /** Lochfüllung: den durch die Maske ausgeblendeten Bereich aus der Umgebung auffüllen; Ebene wird deckend. */
  holeFill: boolean;
  focusMap?: FocusMapSpec;
  shadow?: ShadowLayer;
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
  origin?: { kind: 'auto-fg-bg' | 'depth-split' | 'sam-objects'; sourceLayerId: string };
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
  /** Lizenzmodus, in dem zuletzt gearbeitet wurde (Spec: Projektdatei speichert ihn) */
  licenseMode: LicenseMode;
};

export const newId = (): string => crypto.randomUUID();

export function createProjectFromImage(
  original: OriginalRef,
  name?: string,
  licenseMode: LicenseMode = 'commercial',
): Project {
  const now = new Date().toISOString();
  const layer: Layer = {
    kind: 'layer',
    id: newId(),
    name: original.fileName.replace(/\.[^.]+$/, ''),
    originalId: original.id,
    mask: { kind: 'full' },
    maskSource: 'full',
    maskEdge: { ...DEFAULT_MASK_EDGE },
    holeFill: false,
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
    licenseMode,
  };
}

// ---------- Baum-Hilfen ----------

/** Effekt-Träger: Ebene, Gruppe oder Schatten einer Ebene. */
export type EffectHost = SceneNode | ShadowLayer;

/** Findet Knoten oder Schatten (über die Schatten-ID). */
export function findHost(root: Group, id: string): { host: EffectHost; layer?: Layer } | undefined {
  for (const n of walk(root)) {
    if (n.id === id) return { host: n };
    if (n.kind === 'layer' && n.shadow?.id === id) return { host: n.shadow, layer: n };
  }
  return undefined;
}

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

export function updateLayer(project: Project, id: string, fn: (l: Layer) => Layer): Project {
  return updateNode(project, id, (n) => (n.kind === 'layer' ? fn(n) : n));
}

/** Ändert einen Effekt-Träger (auch einen Schatten über seine ID). */
export function updateHost(project: Project, id: string, fn: (h: EffectHost) => EffectHost): Project {
  const found = findHost(project.root, id);
  if (!found) return project;
  if (found.layer) {
    return updateLayer(project, found.layer.id, (l) =>
      l.shadow ? { ...l, shadow: fn(l.shadow) as ShadowLayer } : l,
    );
  }
  return updateNode(project, id, (n) => fn(n) as SceneNode);
}

export function* walkLayers(root: Group): Generator<Layer> {
  for (const n of walk(root)) if (n.kind === 'layer') yield n;
}

/** Ersetzt einen Knoten (gleiche Position im Baum). */
export function replaceNode(project: Project, id: string, next: SceneNode): Project {
  return updateNode(project, id, () => next);
}

// ---------- Effekt-Stack ----------

function updateEffects(
  project: Project,
  nodeId: string,
  fn: (e: EffectInstance[]) => EffectInstance[],
): Project {
  return updateHost(project, nodeId, (n) => ({ ...n, effects: fn(n.effects) }));
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

/** IDs aller gespeicherten Masken eines Projekts. */
export function maskIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const l of walkLayers(project.root)) if (l.mask.kind === 'stored') ids.add(l.mask.id);
  return ids;
}

/** Erste sichtbare Ebene (für die Auswahl beim Öffnen). */
export function firstLayer(project: Project): Layer | undefined {
  for (const n of walk(project.root)) if (n.kind === 'layer') return n;
  return undefined;
}
