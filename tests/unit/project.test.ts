import { describe, expect, it } from 'vitest';
import {
  addEffect,
  createProjectFromImage,
  findNode,
  moveEffect,
  removeEffect,
  setEffectParams,
  updateEffect,
  moveNode,
  wrapInGroup,
  ungroup,
  setParamInGroup,
  setEffectMask,
  setGroupMask,
  type EffectInstance,
  type SceneNode,
} from '../../src/state/project';
import { parseProject } from '../../src/io/projectSchema';
import { packProject, unpackProject } from '../../src/io/projectFile';
import { projectReach } from '../../src/render/compositor';

const original = {
  id: 'a'.repeat(64),
  fileName: 'foto.jpg',
  mimeType: 'image/jpeg',
  width: 400,
  height: 300,
};
const fx = (id: string, effectId = 'gaussian-blur'): EffectInstance => ({
  instanceId: id,
  effectId,
  effectVersion: '1.0.0',
  enabled: true,
  strength: 1,
  params: { radius: 10 },
  region: 'whole',
});

describe('Projekt-Operationen', () => {
  const p0 = createProjectFromImage(original);
  const layer = p0.root.children[0];
  if (!layer) throw new Error();

  it('legt ein Projekt mit einer Ebene an', () => {
    expect(p0.canvas).toMatchObject({ width: 400, height: 300 });
    expect(layer.kind).toBe('layer');
    expect(p0.name).toBe('foto');
  });

  it('fügt hinzu, sortiert, ändert und entfernt Effekte unveränderlich', () => {
    let p = addEffect(p0, layer.id, fx('1'));
    p = addEffect(p, layer.id, fx('2', 'black-white'));
    p = addEffect(p, layer.id, fx('3', 'color-overlay'));
    expect(p0.root.children[0]?.effects).toHaveLength(0);
    const ids = () => findNode(p.root, layer.id)?.effects.map((e) => e.instanceId);
    expect(ids()).toEqual(['1', '2', '3']);
    p = moveEffect(p, layer.id, '3', 0);
    expect(ids()).toEqual(['3', '1', '2']);
    p = moveEffect(p, layer.id, '3', 2);
    expect(ids()).toEqual(['1', '2', '3']);
    const before = p;
    p = setEffectParams(p, layer.id, '1', { radius: 99 });
    expect(findNode(p.root, layer.id)?.effects[0]?.params.radius).toBe(99);
    expect(findNode(before.root, layer.id)?.effects[0]?.params.radius).toBe(10);
    p = updateEffect(p, layer.id, '2', { enabled: false });
    expect(findNode(p.root, layer.id)?.effects[1]?.enabled).toBe(false);
    p = removeEffect(p, layer.id, '2');
    expect(ids()).toEqual(['1', '3']);
  });

  it('lässt unbeteiligte Teilbäume identisch (strukturelles Teilen)', () => {
    const p = updateEffect(p0, 'gibt-es-nicht', 'x', { enabled: false });
    expect(p).toBe(p0);
  });

  it('berechnet die Export-Überlappung entlang des tiefsten Pfads', () => {
    let p = addEffect(p0, layer.id, fx('1'));
    p = addEffect(p, layer.id, fx('2'));
    p = addEffect(p, p.root.id, fx('3'));
    expect(projectReach(p.root, () => 10)).toBe(30);
  });
});

describe('Projektdatei', () => {
  it('Rundreise über ZIP', () => {
    const p = addEffect(createProjectFromImage(original), createProjectFromImage(original).root.id, fx('9'));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const zip = packProject(p, new Map([[original.id, bytes]]));
    const { project, originals } = unpackProject(zip);
    expect(project).toEqual(p);
    expect([...(originals.get(original.id) ?? [])]).toEqual([1, 2, 3, 4]);
  });

  it('lehnt beschädigte Dateien verständlich ab', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3]))).toThrow(/ZIP/);
    const p = createProjectFromImage(original);
    expect(() => packProject(p, new Map())).toThrow(/fehlt/);
  });
});

describe('parseProject', () => {
  it('prüft Struktur und Verweise', () => {
    const p = createProjectFromImage(original);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parseProject({ ...p, formatVersion: 99 })).toThrow(/neuer/);
    expect(() => parseProject({ ...p, originals: {} })).toThrow(/fehlendes Original/);
    expect(() => parseProject({ ...p, root: { ...p.root, kind: 'layer' } })).toThrow();
  });

  it('migriert Format 2 → 7 und prüft Tiefenmasken und Transformation', () => {
    const p = createProjectFromImage(original);
    const v2 = JSON.parse(JSON.stringify({ ...p, formatVersion: 2 })) as Record<string, unknown>;
    const migrated = parseProject(v2);
    expect(migrated.formatVersion).toBe(7);
    expect(migrated.root).toEqual(p.root);

    const layer = p.root.children[0];
    if (layer?.kind !== 'layer') throw new Error('keine Ebene');
    const depthMap = {
      id: 'd1',
      width: 400,
      height: 300,
      provenance: { modelId: 'depth-anything-v2-small', commercialUse: true, createdAt: '2026-10-14' },
    };
    const withDepth = {
      ...p,
      root: {
        ...p.root,
        children: [
          {
            ...layer,
            depthMap,
            mask: { kind: 'depth', depthId: 'd1', near: 0.2, far: 0.5, overlap: 16, fillBelow: 0.2 },
          },
        ],
      },
    };
    expect(parseProject(JSON.parse(JSON.stringify(withDepth)))).toEqual(withDepth);
    const broken = JSON.parse(JSON.stringify(withDepth)) as typeof withDepth;
    (broken.root.children[0] as { mask: { near: unknown } }).mask.near = 'nah';
    expect(() => parseProject(broken)).toThrow();

    const flipped = {
      ...p,
      root: { ...p.root, children: [{ ...layer, transform: { ...layer.transform, flipX: true } }] },
    };
    expect(parseProject(JSON.parse(JSON.stringify(flipped)))).toEqual(flipped);
    const badScale = {
      ...p,
      root: { ...p.root, children: [{ ...layer, transform: { ...layer.transform, scale: 0 } }] },
    };
    expect(() => parseProject(JSON.parse(JSON.stringify(badScale)))).toThrow(/transform/);
  });

  it('Format 5/6: Mischmodus und Maske je Effekt', () => {
    const p = addEffect(createProjectFromImage(original), createProjectFromImage(original).root.id, fx('m'));
    expect(p.formatVersion).toBe(7);
    const withMix = {
      ...p,
      root: {
        ...p.root,
        effects: [
          {
            ...fx('m'),
            blendMode: 'screen',
            mask: { kind: 'map', map: 'luminance', from: 0, to: 0.3, feather: 0.05, invert: true },
          },
          { ...fx('n'), mask: { kind: 'layer', layerId: 'x', invert: false } },
        ],
      },
    };
    expect(parseProject(JSON.parse(JSON.stringify(withMix)))).toEqual(withMix);
    const bad = (e: Record<string, unknown>) => ({
      ...p,
      root: { ...p.root, effects: [{ ...fx('b'), ...e }] },
    });
    expect(() => parseProject(bad({ blendMode: 'dodge' }))).toThrow(/blendMode/);
    expect(() =>
      parseProject(bad({ mask: { kind: 'map', map: 'xray', from: 0, to: 1, feather: 0, invert: false } })),
    ).toThrow(/Kartenbereich/);
    expect(() => parseProject(bad({ mask: { kind: 'brush' } }))).toThrow(/mask\.kind/);
    // altes Projekt (Format 4) wird ohne Änderung auf 6 gehoben
    expect(parseProject({ ...JSON.parse(JSON.stringify(p)), formatVersion: 4 }).formatVersion).toBe(7);
  });

  it('Format 6: Maske einer Gruppe', () => {
    const p = createProjectFromImage(original);
    const g = {
      ...p,
      root: {
        ...p.root,
        mask: { kind: 'map', map: 'edges', from: 0.2, to: 1, feather: 0.05, invert: false },
      },
    };
    expect(parseProject(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(() => parseProject({ ...p, root: { ...p.root, mask: { kind: 'map', map: 'xray' } } })).toThrow(
      /root\.mask/,
    );
    let q = setGroupMask(p, p.root.id, { kind: 'layer', layerId: 'x', invert: false });
    expect(q.root.mask).toEqual({ kind: 'layer', layerId: 'x', invert: false });
    q = setGroupMask(q, q.root.id, undefined);
    expect('mask' in q.root).toBe(false);
  });

  it('setEffectMask setzt und entfernt die Maske', () => {
    const base = createProjectFromImage(original);
    let p = addEffect(base, base.root.id, fx('m'));
    p = setEffectMask(p, p.root.id, 'm', { kind: 'layer', layerId: 'x', invert: true });
    expect(p.root.effects[0]?.mask).toEqual({ kind: 'layer', layerId: 'x', invert: true });
    p = setEffectMask(p, p.root.id, 'm', undefined);
    expect(p.root.effects[0] && 'mask' in p.root.effects[0]).toBe(false);
  });
});

describe('Gruppen: Baum umbauen und Gruppenbearbeitung', () => {
  const base = createProjectFromImage(original);
  const layerA = base.root.children[0];
  if (!layerA || layerA.kind !== 'layer') throw new Error();
  const mk = (id: string, effectId?: string): typeof layerA => ({
    ...layerA,
    id,
    name: id,
    effects: effectId ? [fx(`${id}-fx`, effectId)] : [],
  });
  // Wurzel: [A, G[B, C], D]
  const p0 = {
    ...base,
    root: {
      ...base.root,
      children: [
        mk('A', 'gaussian-blur'),
        {
          kind: 'group' as const,
          id: 'G',
          name: 'G',
          children: [mk('B', 'gaussian-blur'), mk('C', 'gaussian-blur')],
          editMode: 'group' as const,
          effects: [],
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
        mk('D'),
      ],
    },
  };
  const ids = (n: SceneNode): unknown => (n.kind === 'group' ? [n.id, n.children.map(ids)] : n.id);

  it('verschiebt Knoten zwischen Gruppen und verhindert Zyklen', () => {
    let p = moveNode(p0, 'D', 'G', 0);
    expect(ids(p.root)).toEqual([p0.root.id, ['A', ['G', ['D', 'B', 'C']]]]);
    p = moveNode(p, 'B', p.root.id, 0);
    expect(ids(p.root)).toEqual([p0.root.id, ['B', 'A', ['G', ['D', 'C']]]]);
    expect(moveNode(p, 'G', 'G', 0)).toBe(p);
    expect(moveNode(p, p.root.id, 'G', 0)).toBe(p);
  });

  it('gruppiert und löst Gruppen auf', () => {
    const { project, groupId } = wrapInGroup(p0, 'A', 'Neu');
    expect(ids(project.root)).toEqual([p0.root.id, [[groupId, ['A']], ['G', ['B', 'C']], 'D']]);
    expect(ids(ungroup(project, 'G').root)).toEqual([p0.root.id, [[groupId, ['A']], 'B', 'C', 'D']]);
  });

  it('Gruppenbearbeitung schreibt in alle Kinder, entkoppelte behalten ihren Wert', () => {
    let p = updateEffect(p0, 'C', 'C-fx', { decoupled: ['radius'] });
    p = setParamInGroup(p, 'G', 'gaussian-blur', 'radius', 77);
    const r = (id: string) => findNode(p.root, id)?.effects[0]?.params.radius;
    expect(r('B')).toBe(77);
    expect(r('C')).toBe(10);
    expect(r('A')).toBe(10); // nicht in der Gruppe
  });

  it('Format 7: Malplan-Einstellungen werden geprüft und ergänzt', () => {
    const p = createProjectFromImage(original);
    const raw = JSON.parse(
      JSON.stringify({ ...p, formatVersion: 7, malplan: { shapes: 5000, colors: 9 } }),
    ) as unknown;
    const parsed = parseProject(raw);
    expect(parsed.malplan?.shapes).toBe(2000);
    expect(parsed.malplan?.colors).toBe(9);
    expect(parsed.malplan?.values.levels).toBe(4);
    expect(() => parseProject({ ...(raw as object), malplan: 3 })).toThrow(/malplan/);
  });
});
