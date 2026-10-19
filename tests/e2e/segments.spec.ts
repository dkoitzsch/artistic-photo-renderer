// E3 Schritt 2: Segmente – Markierung als Segment speichern, als Effektmaske nutzen (auch umgekehrt), Ansicht
// „Segmente“, Löschen entfernt die Maske; Segment als Markierung laden. Ohne ML-Modell (Markierung per Pinsel).

import { expect, test, type Page } from '@playwright/test';
import { canvasPixel, openFixture, renderExport, waitForApp } from './helpers';

async function paintSelection(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bls = window.__bls;
    const p = bls.getProject();
    const layer = p?.root.children[0];
    if (!p || !layer) throw new Error('keine Ebene');
    // linke Bildhälfte als dicker Strich markieren
    const { width: w, height: h } = p.canvas;
    const id = bls.commands.beginStroke();
    bls.commands.paintStrokeCommand(
      layer.id,
      'selection',
      {
        mode: 'add',
        size: w * 0.5,
        softness: 0,
        flow: 1,
        pressure: false,
        points: [w * 0.25, -h, 1, w * 0.25, h * 2, 1],
      },
      id,
      false,
    );
    return layer.id;
  });
}

test('Segment aus Markierung: Effektmaske, Ansicht, Löschen', async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);
  const layerId = await paintSelection(page);
  const original = await renderExport(page);

  // als Segment speichern (Inspektor; Abschnitt ggf. aufklappen)
  if (!(await page.getByTestId('segment-name').count()))
    await page.getByTestId('segment-section').getByRole('button', { name: 'Segmente' }).click();
  await page.getByTestId('segment-name').fill('Links');
  await page.getByTestId('segment-save').click();
  const seg = await page.evaluate(() => window.__bls.getProject()?.segments?.[0]);
  expect(seg?.name).toBe('Links');

  // Farbfläche nur im Segment
  const fxId = await page.evaluate(
    ({ layerId, segId }) => {
      const c = window.__bls.commands;
      const id = c.addEffectCommand('color-overlay', layerId);
      if (!id) throw new Error('color-overlay fehlt');
      c.setEffectMaskCommand(layerId, id, { kind: 'segment', segmentId: segId, invert: false }, false);
      return id;
    },
    { layerId, segId: seg?.id ?? '' },
  );
  const masked = await renderExport(page);
  const px = (img: typeof masked, fx: number) => {
    const i = (Math.floor(img.height / 2) * img.width + Math.floor(fx * img.width)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  expect(px(masked, 0.2)).not.toEqual(px(original, 0.2));
  expect(px(masked, 0.8)).toEqual(px(original, 0.8));

  // umgekehrt: nur rechts
  await page.evaluate(
    ({ layerId, fxId, segId }) => {
      window.__bls.commands.setEffectMaskCommand(
        layerId,
        fxId,
        { kind: 'segment', segmentId: segId, invert: true },
        false,
      );
    },
    { layerId, fxId, segId: seg?.id ?? '' },
  );
  const inv = await renderExport(page);
  expect(px(inv, 0.2)).toEqual(px(original, 0.2));
  expect(px(inv, 0.8)).not.toEqual(px(original, 0.8));

  // Ansicht „Segmente“ färbt die linke Hälfte ein
  const before = await canvasPixel(page, 0.2, 0.5);
  await page.keyboard.press('5');
  await page.getByTestId('analysis-panel').getByRole('combobox', { name: 'Karte' }).selectOption('segments');
  await expect.poll(() => canvasPixel(page, 0.2, 0.5)).not.toEqual(before);
  await page.keyboard.press('1');

  // Segment löschen → Effektmaske entfällt (Effekt wirkt überall)
  await page.getByTestId('segment-section').getByRole('button', { name: 'Löschen' }).click();
  const after = await page.evaluate(() => {
    const p = window.__bls.getProject();
    const l = p?.root.children[0];
    return { segs: p?.segments?.length ?? 0, mask: l?.effects[0]?.mask ?? null };
  });
  expect(after).toEqual({ segs: 0, mask: null });
  // Undo stellt Segment und Maske wieder her
  await page.getByTestId('undo').click();
  const restored = await page.evaluate(() => {
    const p = window.__bls.getProject();
    return { segs: p?.segments?.length ?? 0, mask: p?.root.children[0]?.effects[0]?.mask?.kind ?? null };
  });
  expect(restored).toEqual({ segs: 1, mask: 'segment' });
});

test('Segment als Markierung laden', async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);
  const layerId = await paintSelection(page);
  const segId = await page.evaluate(
    (layerId) => window.__bls.commands.saveSelectionAsSegmentCommand(layerId, 'A'),
    layerId,
  );
  await page.evaluate((layerId) => {
    window.__bls.commands.clearPaintCommand(layerId, 'selection');
  }, layerId);
  await page.evaluate(
    ({ layerId, segId }) => {
      window.__bls.commands.selectSegmentCommand(layerId, segId ?? '');
    },
    { layerId, segId },
  );
  const sel = await page.evaluate(async (layerId) => {
    const p = window.__bls.getProject();
    if (!p) throw new Error('kein Projekt');
    const d = await window.__bls.getEngine()?.readMap(p, layerId, 'selection');
    const at = (fx: number) =>
      d?.[(Math.floor(p.canvas.height / 2) * p.canvas.width + Math.floor(fx * p.canvas.width)) * 4] ?? -1;
    return [at(0.2), at(0.8)];
  }, layerId);
  expect(sel[0]).toBeGreaterThan(0.9);
  expect(sel[1]).toBeLessThan(0.1);
});
