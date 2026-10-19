// „Stil je Bereich“ (Spec „Effekte“ 5.8, style-per-region): aus einer Ebene wird eine Gruppe mit einer Ebene je Bereich –
// unten der Rest (Hintergrund, Maske der Quelle), darüber Segmente bzw. Tiefenbereiche als Ebenenmasken, jede mit eigenem
// Effektstapel. Umsetzung über das Ebenensystem statt als Plugin (DECISIONS.md „E3“). Rein und getestet.

import type { EffectInstance, Group, Layer, Segment } from './project';

export type RegionSource =
  { kind: 'rest' } | { kind: 'segment'; segmentId: string } | { kind: 'depth'; near: number; far: number };

export type RegionSpec = { name: string; source: RegionSource; effects: EffectInstance[] };

/** Weicher Rand eines Tiefenbereichs (Leinwand-px) */
export const REGION_DEPTH_OVERLAP = 12;

/**
 * Baut die Gruppe „Stil je Bereich“. Reihenfolge der Kinder: Rest zuerst (ganz hinten), dann die übrigen Bereiche in der
 * angegebenen Reihenfolge. depthId: Tiefenkarte für Tiefenbereiche (fehlt sie, entfallen diese Bereiche).
 */
export function buildRegionGroup(
  layer: Layer,
  regions: RegionSpec[],
  segments: readonly Segment[],
  depthId: string | null,
  newId: () => string,
): Group {
  const base = (name: string, effects: EffectInstance[]): Layer => {
    const { shadow: _s, selection: _sel, holeMask: _h, ...rest } = layer;
    return {
      ...rest,
      id: newId(),
      name: `${layer.name} – ${name}`,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
      effects: effects.map((e) => ({ ...e, instanceId: newId() })),
    };
  };
  const children: Layer[] = [];
  const ordered = [
    ...regions.filter((r) => r.source.kind === 'rest'),
    ...regions.filter((r) => r.source.kind !== 'rest'),
  ];
  for (const r of ordered) {
    const src = r.source;
    if (src.kind === 'rest') {
      children.push(base(r.name, r.effects));
    } else if (src.kind === 'segment') {
      const seg = segments.find((s) => s.id === src.segmentId && s.originalId === layer.originalId);
      if (!seg) continue;
      const l = base(r.name, r.effects);
      const { maskStrokes: _m, ...noStrokes } = l;
      children.push({
        ...noStrokes,
        mask: seg.mask.base,
        ...(seg.mask.strokes.length ? { maskStrokes: seg.mask.strokes } : {}),
        maskSource: 'brush',
        holeFill: false,
        initial: { mask: seg.mask.base, maskEdge: layer.maskEdge, holeFill: false },
      });
    } else {
      if (!depthId) continue;
      const near = Math.min(src.near, src.far);
      const far = Math.max(src.near, src.far);
      const mask = {
        kind: 'depth' as const,
        depthId,
        near,
        far,
        overlap: REGION_DEPTH_OVERLAP,
        fillBelow: 0,
      };
      const l = base(r.name, r.effects);
      const { maskStrokes: _m, ...noStrokes } = l;
      children.push({
        ...noStrokes,
        mask,
        maskSource: 'depth',
        holeFill: false,
        depth: (near + far) / 2,
        initial: { mask, maskEdge: layer.maskEdge, holeFill: false },
      });
    }
  }
  return {
    kind: 'group',
    id: newId(),
    name: 'Stil je Bereich',
    children,
    editMode: 'individual',
    effects: [],
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    visible: layer.visible,
    origin: { kind: 'style-regions', sourceLayerId: layer.id },
  };
}

/**
 * Mittlere Tiefe je Bereichsebene für die Parallax-Vorschau: gewichtet mit der Maske der Ebene; der Rest zählt nur dort,
 * wo kein anderer Bereich liegt. depth/masks: Werte 0…1 je Pixel (gleich groß).
 */
export function regionDepths(
  depth: Float32Array,
  masks: Float32Array[],
  restIndex: number,
): (number | undefined)[] {
  const n = depth.length;
  const sums = masks.map(() => [0, 0]);
  for (let i = 0; i < n; i++) {
    const d = depth[i] ?? 0;
    let others = 0;
    masks.forEach((m, k) => {
      if (k !== restIndex) others = Math.max(others, m[i] ?? 0);
    });
    masks.forEach((m, k) => {
      const w = k === restIndex ? (m[i] ?? 0) * (1 - others) : (m[i] ?? 0);
      const s = sums[k];
      if (!s) return;
      s[0] = (s[0] ?? 0) + d * w;
      s[1] = (s[1] ?? 0) + w;
    });
  }
  return sums.map(([a = 0, b = 0]) => (b > 1e-6 ? a / b : undefined));
}
