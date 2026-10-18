// Datenmodell nach SPEC „Datenmodell“. Unveränderliche Daten: alle Funktionen liefern neue Objekte
// (strukturelles Teilen), damit History-Snapshots billig sind.

import type { ParamValue } from '../effects/manifest';

import type { MalplanSettings } from '../malplan/model';

export const PROJECT_FORMAT_VERSION = 8;

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
  /** leer (nichts sichtbar) – Grundlage gemalter Masken und Markierungen */
  | { kind: 'empty' }
  | { kind: 'stored'; id: string; width: number; height: number; inverted: boolean; provenance: Provenance }
  | DepthBandMask;

/**
 * Tiefenband aus einer Tiefenkarte (0 = nah … 1 = fern): sichtbar ist [near, far], um overlap px weich erweitert.
 * fillBelow: Bereiche näher als dieser Wert sind „Loch“ für die Lochfüllung (Inhalte vorderer Ebenen).
 */
export type DepthBandMask = {
  kind: 'depth';
  depthId: string;
  near: number;
  far: number;
  /** Leinwand-px */
  overlap: number;
  fillBelow: number;
};

/** Tiefenkarte eines Originals (16 Bit, volle Größe; depth/<id>.png) */
export type DepthMapRef = { id: string; width: number; height: number; provenance: Provenance };

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
  /** Ebenen-px (Pixel des Originals; bei der Standard-Transformation = Leinwand-px) */
  x: number;
  y: number;
  radius: number;
  enabled: boolean;
};

/**
 * Pinselstrich (Basis-Spec g) als Vektordaten: Punkte [x, y, Druck, …] in Ebenen-px, Durchmesser in Ebenen-px,
 * Weichheit 0 (hart) … 1 (weich), Fluss = Deckkraft je Tupfer, Modus hinzufügen/entfernen. Gerastert auf der GPU.
 */
export type BrushStroke = {
  mode: 'add' | 'remove';
  size: number;
  softness: number;
  flow: number;
  pressure: boolean;
  points: number[];
};

/** Maske aus Grundmaske und Pinselstrichen darüber (Markierung, Lochbereich). */
export type PaintedMask = { base: MaskRef; strokes: BrushStroke[] };

export type FocusMapSpec = {
  points: FocusPoint[];
  provenance?: Provenance;
  /** gemalt: hinzufügen = schärfer, entfernen = unschärfer (Projektformat 8) */
  strokes?: BrushStroke[];
};

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

/** Karten, deren Wertebereich als Effektmaske dient (0…1). */
export type MaskMapId = 'luminance' | 'edges' | 'depth';

/**
 * Eigene Maske eines Effekts (zusätzlich zur Ebenenmaske):
 * "map": Bereich einer Analysekarte der Ebene, z. B. Helligkeit 0–30 % (weicher Rand feather, Kartenwerte 0…1);
 * "layer": aufbereitete Maske einer anderen Ebene (z. B. die Person aus der Vordergrund-Aufteilung).
 */
export type EffectMask =
  | { kind: 'map'; map: MaskMapId; from: number; to: number; feather: number; invert: boolean }
  | { kind: 'layer'; layerId: string; invert: boolean };

export type EffectInstance = {
  instanceId: string;
  effectId: string;
  effectVersion: string;
  enabled: boolean;
  /** 0..1, Mischung mit dem Eingang */
  strength: number;
  params: Record<string, ParamValue>;
  region: EffectRegion;
  /** Gruppenmodus: diese Parameter werden von der Gruppenbearbeitung nicht überschrieben (Schloss) */
  decoupled?: string[];
  /** Mischmodus des Effekts mit seinem Eingang (fehlt = normal: Effekt ersetzt den Eingang) */
  blendMode?: BlendMode;
  /** eigene Maske des Effekts (fehlt = überall) */
  mask?: EffectMask;
};

/**
 * Platzierung auf der Leinwand (siehe state/transform.ts): x/y = Versatz der Bildmitte zur Leinwandmitte in Leinwand-px,
 * scale = Leinwand-px pro Original-px, rotation in Grad (im Uhrzeigersinn), flipX/flipY = gespiegelt.
 */
export type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
};

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
  /** Tiefenkarte des Originals (Ansicht „Tiefe“, Effekt-Eingang depth) */
  depthMap?: DepthMapRef;
  /** mittlere Tiefe 0…1 (Tiefenebenen) */
  depth?: number;
  transform: Transform;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  effects: EffectInstance[];
  /** Pinselstriche auf der Ebenenmaske, nach dem Kantenübergang (Projektformat 8) */
  maskStrokes?: BrushStroke[];
  /** Markierung der Ebene (Pinsel, Smarte Auswahl) – Grundlage für Hervorheben und Extrahieren */
  selection?: PaintedMask;
  /** Lochbereich aus einer Markierung (Hervorheben mit Lochfüllung) statt aus der Maske */
  holeMask?: PaintedMask;
  /** Ausgangszustand für „Layer auf Original zurücksetzen“ */
  initial?: { mask: MaskRef; maskEdge: MaskEdge; holeFill: boolean };
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
  /**
   * Maske der Gruppe (Spec „Effekte“ 2.2a): wirkt nach den Gruppeneffekten auf das Gruppenergebnis.
   * Kartenbereiche beziehen sich auf das zusammengeführte Ergebnis vor den Gruppeneffekten (Tiefe: erste Ebene mit Tiefe).
   */
  mask?: EffectMask;
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
  /** Malplan-Einstellungen (Projektformat 7); fehlen = Standardwerte */
  malplan?: MalplanSettings;
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

/** Setzt oder entfernt (undefined) die eigene Maske eines Effekts. */
export function setEffectMask(
  project: Project,
  nodeId: string,
  instanceId: string,
  mask: EffectMask | undefined,
): Project {
  return updateEffects(project, nodeId, (list) =>
    list.map((e) => {
      if (e.instanceId !== instanceId) return e;
      const { mask: _old, ...rest } = e;
      return mask ? { ...rest, mask } : rest;
    }),
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

/** IDs aller Tiefenkarten eines Projekts. */
export function depthIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const l of walkLayers(project.root)) {
    if (l.depthMap) ids.add(l.depthMap.id);
    if (l.mask.kind === 'depth') ids.add(l.mask.depthId);
  }
  return ids;
}

/** Elterngruppe eines Knotens */
export function parentOf(root: Group, id: string): Group | undefined {
  for (const n of walk(root)) if (n.kind === 'group' && n.children.some((c) => c.id === id)) return n;
  return undefined;
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

// ---------- Gruppenbearbeitung (Spec h) ----------

/**
 * Schreibt einen Parameter in alle direkten Kinder der Gruppe, die den Effekt haben (jeweils dessen erste Instanz),
 * außer dort, wo der Parameter entkoppelt ist. exceptNodeId: Kind, das bereits geändert wurde.
 */
export function setParamInGroup(
  project: Project,
  groupId: string,
  effectId: string,
  key: string,
  value: ParamValue,
  exceptNodeId?: string,
): Project {
  const group = findNode(project.root, groupId);
  if (group?.kind !== 'group') return project;
  let next = project;
  for (const child of group.children) {
    if (child.id === exceptNodeId) continue;
    const fx = child.effects.find((e) => e.effectId === effectId);
    if (!fx || fx.decoupled?.includes(key)) continue;
    next = setEffectParams(next, child.id, fx.instanceId, { [key]: value });
  }
  return next;
}

/** Wie setParamInGroup, für die Mischung (strength). */
export function setStrengthInGroup(
  project: Project,
  groupId: string,
  effectId: string,
  strength: number,
  exceptNodeId?: string,
): Project {
  const group = findNode(project.root, groupId);
  if (group?.kind !== 'group') return project;
  let next = project;
  for (const child of group.children) {
    if (child.id === exceptNodeId) continue;
    const fx = child.effects.find((e) => e.effectId === effectId);
    if (!fx || fx.decoupled?.includes('strength')) continue;
    next = updateEffect(next, child.id, fx.instanceId, { strength });
  }
  return next;
}

// ---------- Baum umbauen (Ebenenliste) ----------

function removeFromTree(group: Group, id: string): { group: Group; removed: SceneNode | undefined } {
  let removed: SceneNode | undefined;
  const children: SceneNode[] = [];
  for (const c of group.children) {
    if (c.id === id) {
      removed = c;
      continue;
    }
    if (c.kind === 'group' && !removed) {
      const r = removeFromTree(c, id);
      if (r.removed) {
        removed = r.removed;
        children.push(r.group);
        continue;
      }
    }
    children.push(c);
  }
  return { group: removed ? { ...group, children } : group, removed };
}

function isDescendant(node: SceneNode, id: string): boolean {
  for (const n of walk(node)) if (n.id === id) return true;
  return false;
}

/**
 * Verschiebt einen Knoten in eine Gruppe an Position index (0 = ganz hinten), bezogen auf die Kinderliste
 * der Zielgruppe nach dem Herausnehmen. Ungültige Züge (Wurzel, in sich selbst) ändern nichts.
 */
export function moveNode(project: Project, nodeId: string, targetGroupId: string, index: number): Project {
  if (nodeId === project.root.id) return project;
  const node = findNode(project.root, nodeId);
  if (!node || isDescendant(node, targetGroupId)) return project;
  const { group: root, removed } = removeFromTree(project.root, nodeId);
  if (!removed) return project;
  const target = findNode(root, targetGroupId);
  if (target?.kind !== 'group') return project;
  const i = Math.max(0, Math.min(target.children.length, index));
  const children = [...target.children.slice(0, i), removed, ...target.children.slice(i)];
  const nextRoot = mapNode(root, targetGroupId, (n) => ({ ...n, children }) as Group);
  return { ...project, root: nextRoot as Group };
}

/** Packt einen Knoten an seiner Stelle in eine neue Gruppe. */
export function wrapInGroup(
  project: Project,
  nodeId: string,
  name = 'Gruppe',
): { project: Project; groupId: string } {
  const node = findNode(project.root, nodeId);
  if (!node || nodeId === project.root.id) return { project, groupId: '' };
  const group: Group = {
    kind: 'group',
    id: newId(),
    name,
    children: [node],
    editMode: 'individual',
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
  return { project: replaceNode(project, nodeId, group), groupId: group.id };
}

/**
 * Fasst mehrere Geschwister-Knoten in einer neuen Gruppe zusammen (Reihenfolge bleibt; die Gruppe liegt an der Stelle
 * des vordersten). Knoten aus verschiedenen Gruppen: nichts geschieht.
 */
export function wrapNodesInGroup(
  project: Project,
  nodeIds: string[],
  name = 'Gruppe',
): { project: Project; groupId: string } {
  const ids = nodeIds.filter((id) => id !== project.root.id);
  if (ids.length === 0) return { project, groupId: '' };
  if (ids.length === 1) return wrapInGroup(project, ids[0] ?? '', name);
  const parent = parentOf(project.root, ids[0] ?? '');
  if (!parent || !ids.every((id) => parent.children.some((c) => c.id === id)))
    return { project, groupId: '' };
  const picked = parent.children.filter((c) => ids.includes(c.id));
  const group: Group = {
    kind: 'group',
    id: newId(),
    name,
    children: picked,
    editMode: 'individual',
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
  const top = Math.max(...picked.map((c) => parent.children.indexOf(c)));
  const children = parent.children.flatMap((c, i) => (i === top ? [group] : ids.includes(c.id) ? [] : [c]));
  return { project: updateNode(project, parent.id, (n) => ({ ...n, children }) as Group), groupId: group.id };
}

/** Löst eine Gruppe auf: ihre Kinder treten an ihre Stelle (Gruppeneffekte entfallen). */
export function ungroup(project: Project, groupId: string): Project {
  if (groupId === project.root.id) return project;
  const parent = parentOf(project.root, groupId);
  const group = findNode(project.root, groupId);
  if (!parent || group?.kind !== 'group') return project;
  const children = parent.children.flatMap((c) => (c.id === groupId ? group.children : [c]));
  return updateNode(project, parent.id, (n) => ({ ...n, children }) as Group);
}

/** Neue Ebene aus einem Original (ohne Maske und Effekte). */
export function newImageLayer(original: OriginalRef, transform: Transform): Layer {
  return {
    kind: 'layer',
    id: newId(),
    name: original.fileName.replace(/\.[^.]+$/, ''),
    originalId: original.id,
    mask: { kind: 'full' },
    maskSource: 'full',
    maskEdge: { ...DEFAULT_MASK_EDGE },
    holeFill: false,
    transform,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
    locked: false,
    effects: [],
  };
}

/** Fügt einen Knoten über dem Bezugsknoten ein (gleiche Gruppe); ohne Bezug ganz vorn in der Wurzel. */
export function insertAbove(project: Project, node: SceneNode, referenceId: string | null): Project {
  const parent =
    referenceId && referenceId !== project.root.id ? parentOf(project.root, referenceId) : undefined;
  const target = parent ?? project.root;
  const i = parent
    ? parent.children.findIndex((c) => c.id === referenceId) + 1
    : project.root.children.length;
  const children = [...target.children.slice(0, i), node, ...target.children.slice(i)];
  const root = mapNode(project.root, target.id, (n) => ({ ...n, children }) as Group);
  return { ...project, root: root as Group };
}

/** Entfernt einen Knoten (samt Inhalt) aus dem Baum. Originale bleiben im Projekt. */
export function removeNode(project: Project, nodeId: string): Project {
  if (nodeId === project.root.id) return project;
  const { group, removed } = removeFromTree(project.root, nodeId);
  return removed ? { ...project, root: group } : project;
}

/**
 * Eine Ebene nach vorn (dir = 1) oder hinten (−1): Der Knoten springt über genau eine sichtbare Ebene –
 * auch in Gruppen hinein oder aus ihnen heraus (z. B. Hintergrund schrittweise zwischen Tiefenebenen).
 * Ausgeblendete Knoten werden übersprungen.
 */
export function stepNode(project: Project, nodeId: string, dir: 1 | -1): Project {
  const root = project.root;
  if (nodeId === root.id || !findNode(root, nodeId)) return project;
  // sichtbare Ebenen hinten → vorn (ohne den Knoten selbst) und Anzahl der Ebenen dahinter
  const order: Layer[] = [];
  let behind = -1;
  const visit = (g: Group) => {
    for (const c of g.children) {
      if (c.id === nodeId) {
        behind = order.length;
        continue;
      }
      if (!c.visible) continue;
      if (c.kind === 'layer') order.push(c);
      else visit(c);
    }
  };
  visit(root);
  if (behind < 0) return project; // in ausgeblendeter Gruppe: nichts zu tun
  const target = dir === 1 ? order[behind] : order[behind - 1];
  if (!target) return moveToEdge(project, nodeId, dir, true);
  const parent = parentOf(root, target.id);
  if (!parent) return project;
  const index = parent.children.filter((c) => c.id !== nodeId).findIndex((c) => c.id === target.id);
  return moveNode(project, nodeId, parent.id, dir === 1 ? index + 1 : index);
}

/**
 * Ganz nach vorn/hinten innerhalb der eigenen Gruppe; liegt der Knoten dort schon am Rand, in der Wurzel.
 * rootOnly: direkt an den Rand der Wurzel.
 */
export function moveToEdge(project: Project, nodeId: string, dir: 1 | -1, rootOnly = false): Project {
  const root = project.root;
  const parent = parentOf(root, nodeId);
  if (!parent) return project;
  const i = parent.children.findIndex((c) => c.id === nodeId);
  const atEdge = dir === 1 ? i === parent.children.length - 1 : i === 0;
  const target = rootOnly || atEdge ? root : parent;
  if (target === parent && atEdge) return project;
  const len = target.children.filter((c) => c.id !== nodeId).length;
  const next = moveNode(project, nodeId, target.id, dir === 1 ? len : 0);
  return next;
}

/** Setzt oder entfernt (undefined) die Maske einer Gruppe. */
export function setGroupMask(project: Project, groupId: string, mask: EffectMask | undefined): Project {
  return updateNode(project, groupId, (n) => {
    if (n.kind !== 'group') return n;
    const { mask: _old, ...rest } = n;
    return mask ? { ...rest, mask } : rest;
  });
}
