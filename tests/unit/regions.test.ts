import { describe, expect, it } from 'vitest';
import { buildRegionGroup, regionDepths } from '../../src/state/regions';
import {
  createProjectFromImage,
  type EffectInstance,
  type Layer,
  type Segment,
} from '../../src/state/project';

const original = { id: 'o1', fileName: 'a.jpg', mimeType: 'image/jpeg', width: 100, height: 80 } as never;
let n = 0;
const id = () => `id${n++}`;
const fx = (effectId: string): EffectInstance => ({
  instanceId: 'x',
  effectId,
  effectVersion: '1.0.0',
  enabled: true,
  strength: 1,
  params: {},
  region: 'whole',
});
const layer = createProjectFromImage(original).root.children[0] as Layer;
const segment: Segment = {
  id: 's1',
  name: 'Person',
  originalId: 'o1',
  color: [1, 0, 0],
  mask: {
    base: {
      kind: 'stored',
      id: 'm1',
      width: 100,
      height: 80,
      inverted: false,
      provenance: { modelId: 'sam2.1-tiny', commercialUse: true, createdAt: '' },
    },
    strokes: [{ mode: 'add', size: 10, softness: 0.5, flow: 1, pressure: false, points: [1, 2, 1] }],
  },
};

describe('Stil je Bereich', () => {
  it('baut Rest unten, Segment und Tiefenbereich darüber mit eigenen Effekten', () => {
    const g = buildRegionGroup(
      { ...layer, effects: [fx('alt')] },
      [
        { name: 'Person', source: { kind: 'segment', segmentId: 's1' }, effects: [fx('kuwahara')] },
        { name: 'Hintergrund', source: { kind: 'rest' }, effects: [fx('linocut'), fx('film-grain')] },
        { name: 'Ferne', source: { kind: 'depth', near: 0.9, far: 0.6 }, effects: [] },
      ],
      [segment],
      'd1',
      id,
    );
    expect(g.name).toBe('Stil je Bereich');
    expect(g.origin).toEqual({ kind: 'style-regions', sourceLayerId: layer.id });
    const kids = g.children as Layer[];
    expect(kids.map((k) => k.name)).toEqual([
      `${layer.name} – Hintergrund`,
      `${layer.name} – Person`,
      `${layer.name} – Ferne`,
    ]);
    expect(kids[0]?.mask).toEqual(layer.mask);
    expect(kids[0]?.effects.map((e) => e.effectId)).toEqual(['linocut', 'film-grain']);
    expect(kids[1]?.mask).toEqual(segment.mask.base);
    expect(kids[1]?.maskStrokes).toEqual(segment.mask.strokes);
    expect(kids[2]?.mask).toMatchObject({ kind: 'depth', depthId: 'd1', near: 0.6, far: 0.9 });
    expect(kids[2]?.depth).toBeCloseTo(0.75);
    // neue IDs für Ebenen und Effekt-Instanzen
    const ids = new Set(kids.flatMap((k) => [k.id, ...k.effects.map((e) => e.instanceId)]));
    expect(ids.size).toBe(kids.length + 3);
  });

  it('überspringt fehlende Segmente und Tiefenbereiche ohne Tiefenkarte', () => {
    const g = buildRegionGroup(
      layer,
      [
        { name: 'Rest', source: { kind: 'rest' }, effects: [] },
        { name: 'X', source: { kind: 'segment', segmentId: 'fehlt' }, effects: [] },
        { name: 'T', source: { kind: 'depth', near: 0, far: 0.3 }, effects: [] },
      ],
      [segment],
      null,
      id,
    );
    expect(g.children).toHaveLength(1);
  });

  it('mittlere Tiefe je Bereich; der Rest zählt nur außerhalb der anderen', () => {
    const depth = Float32Array.from([0.1, 0.1, 0.9, 0.9]);
    const rest = Float32Array.from([1, 1, 1, 1]);
    const person = Float32Array.from([1, 1, 0, 0]);
    const empty = Float32Array.from([0, 0, 0, 0]);
    const d = regionDepths(depth, [rest, person, empty], 0);
    expect(d[0]).toBeCloseTo(0.9);
    expect(d[1]).toBeCloseTo(0.1);
    expect(d[2]).toBeUndefined();
  });
});
