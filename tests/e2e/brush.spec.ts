// Phase 5: Pinselstriche als Vektordaten – Maske, Markierung und Fokuskarte; Kacheln, Undo.
import { expect, test, type Page } from '@playwright/test';
import { addEffect, canvasPixel, diffStats, openFixture, renderExport, waitForApp } from './helpers';

type Target = 'selection' | 'mask' | 'focus';

const paint = (page: Page, target: Target, stroke: Record<string, unknown>) =>
  page.evaluate(
    ({ target, stroke }) => {
      const b = window.__bls;
      const layer = b.getProject()?.root.children[0];
      if (!layer) throw new Error('keine Ebene');
      const id = b.commands.beginStroke();
      b.commands.paintStrokeCommand(layer.id, target, stroke as never, id, false);
      return layer.id;
    },
    { target, stroke },
  );

const readMap = (page: Page, kind: 'mask' | 'selection' | 'focus') =>
  page.evaluate(async (k) => {
    const p = window.__bls.getProject();
    const layer = p?.root.children[0];
    if (!p || !layer) throw new Error('kein Projekt');
    const d = await window.__bls.getEngine()?.readMap(p, layer.id, k);
    return d ? Array.from(d.filter((_, i) => i % 4 === 0)) : null;
  }, kind);

const at = (map: number[] | null, x: number, y: number, w = 400) => map?.[y * w + x] ?? NaN;

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);
});

test('Maske: Entfernen-Strich blendet aus, weiche Kante, Kacheln gleich, Undo', async ({ page }) => {
  const before = await renderExport(page);
  await paint(page, 'mask', {
    mode: 'remove',
    size: 60,
    softness: 0.5,
    flow: 1,
    pressure: false,
    points: [100, 150, 1, 300, 150, 1],
  });
  const m = await readMap(page, 'mask');
  expect(at(m, 200, 150)).toBeLessThan(0.02); // Strichmitte ausgeblendet
  expect(at(m, 200, 60)).toBeGreaterThan(0.98); // außerhalb sichtbar
  const edge = at(m, 200, 150 - 25); // im weichen Rand
  expect(edge).toBeGreaterThan(0.05);
  expect(edge).toBeLessThan(0.95);
  const painted = await renderExport(page);
  expect(painted.data[(150 * 400 + 200) * 4 + 3]).toBeLessThan(5);
  expect(diffStats(painted, await renderExport(page, 64)).max).toBe(0);
  await page.keyboard.press('Meta+z');
  expect(diffStats(before, await renderExport(page)).max).toBe(0);
});

test('Markierung: Fluss baut auf, Entfernen nimmt weg, Ansicht „Markierung“', async ({ page }) => {
  const s = { mode: 'add', size: 40, softness: 0, flow: 0.3, pressure: false, points: [200, 150, 1] };
  await paint(page, 'selection', s);
  const one = at(await readMap(page, 'selection'), 200, 150);
  expect(one).toBeCloseTo(0.3, 1);
  await paint(page, 'selection', s);
  const two = at(await readMap(page, 'selection'), 200, 150);
  expect(two).toBeCloseTo(1 - 0.7 * 0.7, 1);
  await paint(page, 'selection', { ...s, mode: 'remove', flow: 1 });
  expect(at(await readMap(page, 'selection'), 200, 150)).toBeLessThan(0.02);
});

test('Fokuskarte: gemalter Bereich bleibt scharf unter dem Gauß', async ({ page }) => {
  const orig = await renderExport(page);
  await addEffect(page, 'gaussian-blur', { radius: 30, focusBlur: 0, focusSoftness: 0 });
  const blurred = await renderExport(page);
  await paint(page, 'focus', {
    mode: 'add',
    size: 80,
    softness: 0,
    flow: 1,
    pressure: false,
    points: [100, 75, 1],
  });
  const f = await readMap(page, 'focus');
  expect(at(f, 100, 75)).toBeGreaterThan(0.98);
  expect(at(f, 300, 200)).toBeLessThan(0.02);
  const sharp = await renderExport(page);
  // an der Ecke des Farbfelds (100, 75) ist das Ergebnis wieder wie das Original, weiter weg unscharf
  const px = (img: typeof blurred, x: number, y: number) => img.data[(y * 400 + x) * 4] ?? 0;
  expect(Math.abs(px(sharp, 100, 75) - px(orig, 100, 75))).toBeLessThan(4);
  expect(Math.abs(px(blurred, 100, 75) - px(orig, 100, 75))).toBeGreaterThan(20);
  expect(Math.abs(px(sharp, 300, 224) - px(blurred, 300, 224))).toBeLessThan(2);
  expect(diffStats(sharp, await renderExport(page, 64)).max).toBeLessThanOrEqual(1);
});

test('Pinsel-Werkzeug: Ziehen malt eine Markierung mit Schleier, Alt entfernt, [ ] ändert die Größe, Undo', async ({
  page,
}) => {
  await page.keyboard.press('b');
  await expect(page.getByTestId('brush-panel')).toBeVisible();
  const box = await page.getByTestId('brush-overlay').boundingBox();
  if (!box) throw new Error('keine Leinwand');
  const before = await canvasPixel(page, 0.5, 0.5);
  // waagerechter Strich durch die Mitte
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const layer = await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[0];
    return l?.kind === 'layer' ? l : null;
  });
  const strokes = layer?.selection?.strokes ?? [];
  expect(strokes.length).toBe(1);
  expect(strokes[0]?.mode).toBe('add');
  expect((strokes[0]?.points.length ?? 0) / 3).toBeGreaterThan(3);
  // Schleier sichtbar: Farbe an der Strichmitte verändert
  await expect.poll(() => canvasPixel(page, 0.5, 0.5)).not.toEqual(before);
  // Größe mit [ und ]
  const size0 = await page.evaluate(() => window.__bls.store.getState().brush.size);
  await page.keyboard.press(']');
  expect(await page.evaluate(() => window.__bls.store.getState().brush.size)).toBeGreaterThan(size0);
  await page.keyboard.press('[');
  // Alt: Entfernen-Strich
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const modes = await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[0];
    return l?.kind === 'layer' ? (l.selection?.strokes.map((s) => s.mode) ?? []) : [];
  });
  expect(modes).toEqual(['add', 'remove']);
  // ein Zug = ein History-Eintrag
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  const after = await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[0];
    return l?.kind === 'layer' ? (l.selection?.strokes.length ?? 0) : -1;
  });
  expect(after).toBe(0);
});

const selectCircle = (page: Page) =>
  paint(page, 'selection', {
    mode: 'add',
    size: 80,
    softness: 0,
    flow: 1,
    pressure: false,
    points: [200, 150, 1],
  });

test('Hervorheben: neue Ebene über der Quelle bleibt scharf, Quelle optional lochgefüllt; Undo', async ({
  page,
}) => {
  const orig = await renderExport(page);
  await addEffect(page, 'gaussian-blur', { radius: 25 });
  const blurred = await renderExport(page);
  await selectCircle(page);
  await page.keyboard.press('b');
  await expect(page.getByTestId('selection-actions')).toBeVisible();
  await page.getByTestId('highlight').click();
  const tree = await page.evaluate(() =>
    window.__bls.getProject()?.root.children.map((n) => ({
      name: n.name,
      effects: n.effects.length,
      mask: n.kind === 'layer' ? n.mask.kind : '',
      sel: n.kind === 'layer' ? !!n.selection : false,
    })),
  );
  expect(tree?.length).toBe(2);
  expect(tree?.[1]?.name).toMatch(/hervorgehoben$/);
  expect(tree?.[1]?.effects).toBe(0);
  expect(tree?.[1]?.mask).toBe('empty');
  expect(tree?.[0]?.sel).toBe(false);
  const hl = await renderExport(page);
  const px = (img: typeof orig, x: number, y: number) => img.data[(y * 400 + x) * 4] ?? 0;
  // Mitte des Kreises: Ecke des Farbfelds (100, 75) liegt außerhalb; (200, 150) innerhalb → wie das Original
  for (const [x, y] of [
    [200, 150],
    [180, 140],
  ] as const)
    expect(Math.abs(px(hl, x, y) - px(orig, x, y))).toBeLessThanOrEqual(2);
  // außerhalb weiter unscharf
  expect(Math.abs(px(hl, 100, 75) - px(blurred, 100, 75))).toBeLessThanOrEqual(1);
  expect(diffStats(hl, await renderExport(page, 64)).max).toBeLessThanOrEqual(1);
  // Undo: Ebene weg, Markierung wieder da
  await page.keyboard.press('Meta+z');
  const back = await page.evaluate(() => {
    const r = window.__bls.getProject()?.root.children ?? [];
    const l = r[0];
    return { n: r.length, sel: l?.kind === 'layer' && !!l.selection };
  });
  expect(back).toEqual({ n: 1, sel: true });
  // mit Lochfüllung: Quelle bekommt den Lochbereich
  await page.keyboard.press('b');
  await page.getByRole('switch', { name: 'Lochfüllung in der Quelle' }).click();
  await page.getByTestId('highlight').click();
  const hole = await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[0];
    return l?.kind === 'layer' ? { holeFill: l.holeFill, holeMask: !!l.holeMask } : null;
  });
  expect(hole).toEqual({ holeFill: true, holeMask: true });
});

test('Extrahieren behält nur die Markierung; Zurücksetzen stellt Maske und Effekte des Ausgangszustands her', async ({
  page,
}) => {
  await addEffect(page, 'black-white');
  await selectCircle(page);
  await page.keyboard.press('b');
  await page.getByTestId('extract').click();
  const img = await renderExport(page);
  expect(img.data[(150 * 400 + 200) * 4 + 3]).toBeGreaterThan(250); // im Kreis sichtbar
  expect(img.data[(20 * 400 + 20) * 4 + 3]).toBeLessThan(5); // außerhalb ausgeblendet
  await page.getByTestId('reset-layer').click();
  const reset = await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[0];
    return l?.kind === 'layer'
      ? { mask: l.mask.kind, effects: l.effects.length, strokes: l.maskStrokes?.length ?? 0 }
      : null;
  });
  expect(reset).toEqual({ mask: 'full', effects: 0, strokes: 0 });
});
