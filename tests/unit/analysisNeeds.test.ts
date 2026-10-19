import { describe, expect, it } from 'vitest';
import { convexHull, missingMapsWith, requiredMapsWith } from '../../src/ml/analysisNeeds';
import { createProjectFromImage, type Group, type Layer, type Project } from '../../src/state/project';
import { parseProject } from '../../src/io/projectSchema';

const original = { id: 'o1', fileName: 'a.jpg', mimeType: 'image/jpeg', width: 100, height: 80 } as never;
const REQ: Record<string, string[]> = {
  relight: ['normals'],
  fog: ['depth'],
  focus: ['saliency', 'faces'],
  none: [],
};
const requiresOf = (id: string) => REQ[id] ?? [];
const fx = (effectId: string, extra: object = {}) => ({
  instanceId: effectId,
  effectId,
  effectVersion: '1.0.0',
  enabled: true,
  strength: 1,
  params: {},
  region: 'whole' as const,
  ...extra,
});

function project(effects: ReturnType<typeof fx>[]): Project {
  const p = createProjectFromImage(original);
  const l = p.root.children[0] as Layer;
  return { ...p, root: { ...p.root, children: [{ ...l, effects }] } };
}

const ref = (commercialUse = true) => ({
  id: 'm',
  width: 10,
  height: 8,
  provenance: { modelId: 'x', commercialUse, createdAt: '' },
});

describe('Analysekarten: Bedarf', () => {
  it('leitet Karten aus requires und Effektmasken ab (normals → depth)', () => {
    expect(requiredMapsWith(project([fx('relight')]), requiresOf).get('o1')).toEqual(new Set(['depth']));
    expect(requiredMapsWith(project([fx('focus')]), requiresOf).get('o1')).toEqual(
      new Set(['saliency', 'faces']),
    );
    const masked = fx('none', {
      mask: { kind: 'map', map: 'faces', from: 0.5, to: 1, feather: 0, invert: false },
    });
    expect(requiredMapsWith(project([masked]), requiresOf).get('o1')).toEqual(new Set(['faces']));
    expect(requiredMapsWith(project([fx('none')]), requiresOf).size).toBe(0);
  });

  it('ignoriert ausgeschaltete Effekte und unsichtbare Ebenen; eigene Tiefenkarte ersetzt die Analysekarte', () => {
    expect(requiredMapsWith(project([fx('fog', { enabled: false })]), requiresOf).size).toBe(0);
    const p = project([fx('fog')]);
    const l = p.root.children[0] as Layer;
    const hidden = { ...p, root: { ...p.root, children: [{ ...l, visible: false }] } };
    expect(requiredMapsWith(hidden, requiresOf).size).toBe(0);
    const own = { ...p, root: { ...p.root, children: [{ ...l, depthMap: ref() }] } };
    expect(requiredMapsWith(own, requiresOf).size).toBe(0);
  });

  it('Gruppeneffekte nehmen die Karten der ersten sichtbaren Ebene', () => {
    const p = project([]);
    const l = p.root.children[0] as Layer;
    const g: Group = { ...p.root, id: 'g', name: 'G', children: [l], effects: [fx('fog')] };
    const q = { ...p, root: { ...p.root, children: [g] } };
    expect(requiredMapsWith(q, requiresOf).get('o1')).toEqual(new Set(['depth']));
  });

  it('fehlend: nicht vorhanden oder NC im Modus „Kommerziell“; Ansicht fordert zusätzlich an', () => {
    const p = { ...project([fx('fog')]), analysis: { o1: { depth: ref(false) } } };
    expect(missingMapsWith(p, 'commercial', requiresOf)).toEqual([{ originalId: 'o1', kind: 'depth' }]);
    expect(missingMapsWith(p, 'all', requiresOf)).toEqual([]);
    const layerId = p.root.children[0]?.id ?? '';
    expect(missingMapsWith(p, 'all', requiresOf, { layerId, map: 'saliency' })).toEqual([
      { originalId: 'o1', kind: 'saliency' },
    ]);
  });
});

describe('Projektformat 9', () => {
  it('prüft Analysekarten und Segmente und migriert Format 8', () => {
    const p = project([]);
    const withMaps = {
      ...p,
      analysis: { o1: { saliency: ref(), faces: { ...ref(), faceCount: 2 } } },
      segments: [
        {
          id: 's1',
          name: 'Person',
          originalId: 'o1',
          color: [1, 0, 0],
          mask: { base: { kind: 'empty' }, strokes: [] },
        },
      ],
    };
    expect(parseProject(JSON.parse(JSON.stringify(withMaps))).segments?.[0]?.name).toBe('Person');
    expect(() => parseProject({ ...withMaps, analysis: { other: { depth: ref() } } })).toThrow(
      /fehlendes Original/,
    );
    expect(() => parseProject({ ...withMaps, analysis: { o1: { faces: ref() } } })).toThrow(/faceCount/);
    expect(parseProject({ ...p, formatVersion: 8 }).formatVersion).toBe(9);
  });
});

describe('konvexe Hülle', () => {
  it('liefert die Eckpunkte gegen den Uhrzeigersinn', () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 2],
      [0, 2],
      [1, 0.5],
    ]);
    expect(hull).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });
});

describe('gespeicherte Masken eines Projekts', () => {
  it('umfassen Markierung, Lochbereich, Ausgangszustand und Segmente', async () => {
    const { maskIds } = await import('../../src/state/project');
    const stored = (id: string) => ({
      kind: 'stored' as const,
      id,
      width: 1,
      height: 1,
      inverted: false,
      provenance: { modelId: 'x', commercialUse: true, createdAt: '' },
    });
    const p = project([]);
    const l = p.root.children[0] as Layer;
    const q: Project = {
      ...p,
      root: {
        ...p.root,
        children: [
          {
            ...l,
            mask: stored('a'),
            selection: { base: stored('b'), strokes: [] },
            holeMask: { base: stored('c'), strokes: [] },
            initial: { mask: stored('d'), maskEdge: l.maskEdge, holeFill: false },
          },
        ],
      },
      segments: [
        { id: 's', name: 'S', originalId: 'o1', color: [1, 0, 0], mask: { base: stored('e'), strokes: [] } },
      ],
    };
    expect([...maskIds(q)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
