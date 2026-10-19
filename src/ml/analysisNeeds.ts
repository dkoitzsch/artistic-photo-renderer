// Reine Logik der Analysekarten (testbar ohne Browser): welche Karten aus Modellen braucht ein Projekt, welche fehlen.

import {
  walk,
  type AnalysisMapKind,
  type EffectInstance,
  type EffectMask,
  type Group,
  type Layer,
  type LicenseMode,
  type Project,
  type SceneNode,
} from '../state/project';

/** Anforderungen („requires“) eines Effekts */
export type RequiresOf = (effectId: string) => readonly string[];

/** Karten aus Modellen, die eine Anforderung („requires“, Maskenart) braucht. normals → depth. */
function mapsOfRequires(requires: readonly string[]): AnalysisMapKind[] {
  const out: AnalysisMapKind[] = [];
  if (requires.includes('depth') || requires.includes('normals')) out.push('depth');
  if (requires.includes('saliency')) out.push('saliency');
  if (requires.includes('faces')) out.push('faces');
  return out;
}

function mapsOfMask(m: EffectMask | undefined): AnalysisMapKind[] {
  return m?.kind === 'map' && (m.map === 'depth' || m.map === 'saliency' || m.map === 'faces') ? [m.map] : [];
}

function mapsOfEffects(list: EffectInstance[], requiresOf: RequiresOf): AnalysisMapKind[] {
  const out: AnalysisMapKind[] = [];
  for (const fx of list) {
    if (!fx.enabled) continue;
    out.push(...mapsOfRequires(requiresOf(fx.effectId)), ...mapsOfMask(fx.mask));
  }
  return out;
}

/** Hat die Ebene bereits eine eigene Tiefe (Tiefenebenen)? Dann braucht sie keine Analysekarte. */
const ownDepth = (l: Layer) => !!l.depthMap || l.mask.kind === 'depth';

function firstVisibleLayer(g: Group): Layer | undefined {
  for (const n of walk(g)) if (n.kind === 'layer' && n.visible) return n;
  return undefined;
}

/**
 * Welche Karten aus Modellen braucht das Projekt (je Original)? extra: zusätzlich angeforderte Karte (Ansicht).
 * Rein und getestet.
 */
export function requiredMapsWith(
  project: Project,
  requiresOf: RequiresOf,
  extra?: { layerId: string; map: AnalysisMapKind } | null,
): Map<string, Set<AnalysisMapKind>> {
  const out = new Map<string, Set<AnalysisMapKind>>();
  const add = (layer: Layer | undefined, kinds: AnalysisMapKind[]) => {
    if (!layer) return;
    for (const k of kinds) {
      if (k === 'depth' && ownDepth(layer)) continue;
      let set = out.get(layer.originalId);
      if (!set) out.set(layer.originalId, (set = new Set()));
      set.add(k);
    }
  };
  const visit = (n: SceneNode) => {
    if (!n.visible) return;
    if (n.kind === 'layer') {
      add(n, mapsOfEffects(n.effects, requiresOf));
      if (n.shadow?.visible) add(n, mapsOfEffects(n.shadow.effects, requiresOf));
      return;
    }
    // Gruppen: Karten von der ersten sichtbaren Ebene (wie der Compositor)
    const kinds = [...mapsOfEffects(n.effects, requiresOf), ...mapsOfMask(n.mask)];
    if (kinds.length) add(firstVisibleLayer(n), kinds);
    for (const c of n.children) visit(c);
  };
  visit(project.root);
  if (extra) {
    for (const n of walk(project.root))
      if (n.id === extra.layerId) {
        add(n.kind === 'layer' ? n : firstVisibleLayer(n), [extra.map]);
        break;
      }
  }
  return out;
}

/** Fehlende (oder im Lizenzmodus nicht erlaubte) Karten. */
export function missingMapsWith(
  project: Project,
  mode: LicenseMode,
  requiresOf: RequiresOf,
  extra?: { layerId: string; map: AnalysisMapKind } | null,
): { originalId: string; kind: AnalysisMapKind }[] {
  const out: { originalId: string; kind: AnalysisMapKind }[] = [];
  for (const [originalId, kinds] of requiredMapsWith(project, requiresOf, extra))
    for (const kind of kinds) {
      const ref = project.analysis?.[originalId]?.[kind];
      if (!ref || (!ref.provenance.commercialUse && mode === 'commercial')) out.push({ originalId, kind });
    }
  return out;
}

/** Konvexe Hülle (monotone Kette), Punkte gegen den Uhrzeigersinn. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of list) {
      for (;;) {
        const a = out[out.length - 2];
        const b = out[out.length - 1];
        if (!a || !b || cross(a, b, q) > 0) break;
        out.pop();
      }
      out.push(q);
    }
    return out;
  };
  const lower = chain(p);
  const upper = chain([...p].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
