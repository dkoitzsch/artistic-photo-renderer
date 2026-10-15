import { describe, expect, it } from 'vitest';
import {
  createProjectFromImage,
  findNode,
  insertAbove,
  moveToEdge,
  newImageLayer,
  removeNode,
  stepNode,
  type Group,
  type Project,
  type SceneNode,
} from '../../src/state/project';
import {
  apply,
  corners,
  fillTransform,
  fitTransform,
  IDENTITY_TRANSFORM,
  invert,
  isAligned,
  placement,
} from '../../src/state/transform';

const canvas = { width: 400, height: 300 };

describe('Platzierung', () => {
  it('Standard: Original in Leinwandgröße liegt deckungsgleich', () => {
    const m = placement(IDENTITY_TRANSFORM, canvas, canvas);
    expect(apply(m, 0, 0)).toEqual([0, 0]);
    expect(apply(m, 400, 300)).toEqual([400, 300]);
    expect(isAligned(IDENTITY_TRANSFORM, canvas, canvas)).toBe(true);
    expect(isAligned(IDENTITY_TRANSFORM, { width: 200, height: 100 }, canvas)).toBe(false);
  });

  it('kleineres Bild wird zentriert; Versatz, Skalierung, Drehung, Spiegeln', () => {
    const small = { width: 200, height: 100 };
    expect(apply(placement(IDENTITY_TRANSFORM, small, canvas), 0, 0)).toEqual([100, 100]);
    const t = { x: 10, y: -20, scale: 2, rotation: 90 };
    const m = placement(t, small, canvas);
    // Mitte des Bildes → Leinwandmitte + Versatz
    const [cx, cy] = apply(m, 100, 50);
    expect(cx).toBeCloseTo(210);
    expect(cy).toBeCloseTo(130);
    // 90° im Uhrzeigersinn: rechts im Bild → unten auf der Leinwand
    const [rx, ry] = apply(m, 200, 50);
    expect(rx).toBeCloseTo(210);
    expect(ry).toBeCloseTo(130 + 200);
    // Spiegeln: links ↔ rechts
    const [fx] = apply(placement({ ...IDENTITY_TRANSFORM, flipX: true }, small, canvas), 0, 50);
    expect(fx).toBeCloseTo(300);
    // Umkehrung
    const inv = invert(m);
    const [bx, by] = apply(inv, ...apply(m, 37, 81));
    expect(bx).toBeCloseTo(37);
    expect(by).toBeCloseTo(81);
  });

  it('Füllen bedeckt die Leinwand, Einpassen zeigt das ganze Bild', () => {
    const tall = { width: 100, height: 400 };
    const fill = fillTransform(IDENTITY_TRANSFORM, tall, canvas);
    expect(fill.scale).toBeCloseTo(4);
    const fit = fitTransform(IDENTITY_TRANSFORM, tall, canvas);
    expect(fit.scale).toBeCloseTo(0.75);
    // Gedreht um 30°: alle Leinwandecken liegen im Bild
    const rot = fillTransform({ ...IDENTITY_TRANSFORM, rotation: 30 }, tall, canvas);
    const inv = invert(placement(rot, tall, canvas));
    for (const [x, y] of [
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ] as const) {
      const [lx, ly] = apply(inv, x, y);
      expect(lx).toBeGreaterThanOrEqual(-1e-6);
      expect(lx).toBeLessThanOrEqual(100 + 1e-6);
      expect(ly).toBeGreaterThanOrEqual(-1e-6);
      expect(ly).toBeLessThanOrEqual(400 + 1e-6);
    }
    // Eingepasst und gedreht: alle Bildecken auf der Leinwand
    const fitRot = fitTransform({ ...IDENTITY_TRANSFORM, rotation: 30 }, tall, canvas);
    for (const [x, y] of corners(fitRot, tall, canvas)) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(400 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(300 + 1e-6);
    }
  });
});

// ---------- Reihenfolge ----------

const orig = (c: string) => ({ id: c.repeat(64), fileName: `${c}.jpg`, mimeType: 'image/jpeg', ...canvas });

/** Baum als Namen: Gruppen als { Name: [...] } */
function shape(n: SceneNode): unknown {
  return n.kind === 'group' ? { [n.name]: n.children.map(shape) } : n.name;
}

/** Wurzel: [Landschaft, Tiefenebenen[Original (aus), fern, mitte, nah]] */
function scene(): { p: Project; bg: string } {
  let p = createProjectFromImage(orig('a'));
  const photo = p.root.children[0];
  if (photo?.kind !== 'layer') throw new Error();
  const band = (name: string) => ({ ...photo, id: name, name });
  const group: Group = {
    kind: 'group',
    id: 'g',
    name: 'Tiefe',
    children: [
      { ...photo, id: 'o', name: 'Original', visible: false },
      band('fern'),
      band('mitte'),
      band('nah'),
    ],
    editMode: 'individual',
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
  p = { ...p, root: { ...p.root, children: [group] } };
  const bg = newImageLayer(orig('b'), IDENTITY_TRANSFORM);
  p = insertAbove(
    { ...p, originals: { ...p.originals, [orig('b').id]: orig('b') } },
    { ...bg, name: 'L' },
    null,
  );
  p = moveToEdge(p, bg.id, -1, true);
  return { p, bg: bg.id };
}

describe('Ebenen-Reihenfolge', () => {
  it('Hintergrund wandert schrittweise zwischen die Tiefenebenen und wieder hinaus', () => {
    const { p: start, bg } = scene();
    expect(shape(start.root)).toEqual({ Bild: ['L', { Tiefe: ['Original', 'fern', 'mitte', 'nah'] }] });
    const steps: unknown[] = [];
    let p = start;
    for (let i = 0; i < 4; i++) {
      p = stepNode(p, bg, 1);
      steps.push(shape(p.root));
    }
    expect(steps).toEqual([
      { Bild: [{ Tiefe: ['Original', 'fern', 'L', 'mitte', 'nah'] }] },
      { Bild: [{ Tiefe: ['Original', 'fern', 'mitte', 'L', 'nah'] }] },
      { Bild: [{ Tiefe: ['Original', 'fern', 'mitte', 'nah', 'L'] }] },
      // vorn angekommen: aus der Gruppe ganz nach vorn
      { Bild: [{ Tiefe: ['Original', 'fern', 'mitte', 'nah'] }, 'L'] },
    ]);
    // und zurück
    p = stepNode(p, bg, -1);
    expect(shape(p.root)).toEqual({ Bild: [{ Tiefe: ['Original', 'fern', 'mitte', 'L', 'nah'] }] });
    p = stepNode(stepNode(stepNode(p, bg, -1), bg, -1), bg, -1);
    expect(shape(p.root)).toEqual({ Bild: ['L', { Tiefe: ['Original', 'fern', 'mitte', 'nah'] }] });
    // ganz hinten: nichts mehr zu tun
    expect(stepNode(p, bg, -1)).toBe(p);
  });

  it('ganz nach vorn/hinten: erst in der Gruppe, dann in der Wurzel; Löschen', () => {
    const { p: start } = scene();
    let p = moveToEdge(start, 'fern', 1);
    expect(shape(p.root)).toEqual({ Bild: ['L', { Tiefe: ['Original', 'mitte', 'nah', 'fern'] }] });
    p = moveToEdge(p, 'fern', 1);
    expect(shape(p.root)).toEqual({ Bild: ['L', { Tiefe: ['Original', 'mitte', 'nah'] }, 'fern'] });
    expect(moveToEdge(p, 'fern', 1)).toBe(p);
    p = removeNode(p, 'fern');
    expect(findNode(p.root, 'fern')).toBeUndefined();
  });

  it('Einfügen über der Auswahl in derselben Gruppe', () => {
    const { p: start } = scene();
    const layer = { ...newImageLayer(orig('c'), IDENTITY_TRANSFORM), name: 'neu' };
    const p = insertAbove(start, layer, 'mitte');
    expect(shape(p.root)).toEqual({ Bild: ['L', { Tiefe: ['Original', 'fern', 'mitte', 'neu', 'nah'] }] });
  });
});
