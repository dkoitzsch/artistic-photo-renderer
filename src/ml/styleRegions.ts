// „Stil je Bereich“: nach dem Anlegen die mittlere Tiefe jeder Bereichsebene bestimmen (Parallax-Vorschau verschiebt
// Ebenen nach ihrer Tiefe; Abstimmung mit Parallax, Spec „Effekte“ E3). Ohne Tiefenkarte bleibt die Tiefe offen.

import { getEngine } from '../render/runtime';
import { amendPresent } from '../state/commands';
import { findNode, updateNode, type Layer } from '../state/project';
import { regionDepths } from '../state/regions';
import { getProject } from '../state/store';

export async function assignRegionDepths(groupId: string): Promise<void> {
  const project = getProject();
  const engine = getEngine();
  const group = project ? findNode(project.root, groupId) : undefined;
  if (!project || !engine || group?.kind !== 'group') return;
  const layers = group.children.filter((c): c is Layer => c.kind === 'layer');
  const first = layers[0];
  if (!first) return;
  const depthRgba = await engine.readMap(project, first.id, 'depth');
  if (!depthRgba) return;
  const red = (rgba: Float32Array) => {
    const out = new Float32Array(rgba.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] ?? 0;
    return out;
  };
  const masks: Float32Array[] = [];
  for (const l of layers) {
    const m = await engine.readMap(project, l.id, 'mask');
    // ohne eigene Maske liefert readMap eine 1 × 1-Textur (ganze Fläche)
    masks.push(m && m.length === depthRgba.length ? red(m) : new Float32Array(depthRgba.length / 4).fill(1));
  }
  const restIndex = layers.findIndex((l) => l.mask.kind !== 'depth' && l.maskSource !== 'brush');
  const depths = regionDepths(red(depthRgba), masks, Math.max(0, restIndex));
  amendPresent((p) => {
    let next = p;
    layers.forEach((l, k) => {
      const d = depths[k];
      if (d === undefined || l.depth !== undefined) return;
      next = updateNode(next, l.id, (n) => (n.kind === 'layer' ? { ...n, depth: d } : n));
    });
    return next;
  });
}
