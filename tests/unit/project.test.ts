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

  it('migriert Format 2 → 3 und prüft Tiefenmasken', () => {
    const p = createProjectFromImage(original);
    const v2 = JSON.parse(JSON.stringify({ ...p, formatVersion: 2 })) as Record<string, unknown>;
    const migrated = parseProject(v2);
    expect(migrated.formatVersion).toBe(3);
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
});
