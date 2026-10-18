// Phase 5: Pinselstriche als Vektordaten – Maske, Markierung und Fokuskarte; Kacheln, Undo.
import { expect, test, type Page } from '@playwright/test';
import { addEffect, diffStats, openFixture, renderExport, waitForApp } from './helpers';

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
