import { describe, expect, it } from 'vitest';
import {
  addEffect,
  createProjectFromImage,
  findNode,
  moveEffect,
  removeEffect,
  setEffectParams,
  updateEffect,
  type EffectInstance,
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
});
