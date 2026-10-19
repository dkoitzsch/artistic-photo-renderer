// E3 Schritt 7: „Stil je Bereich“ – Dialog, Gruppe mit Bereichsebenen (Rest unten, Segment, Tiefenbereich), eigener
// Stil je Bereich, Tiefe der Bereichsebenen für die Parallax-Vorschau, ein Undo-Schritt.

import { expect, test } from '@playwright/test';
import { openFixture, renderExport, waitForApp } from './helpers';

test('Stil je Bereich: Segment und Hintergrund bekommen verschiedene Stile, Tiefe für Parallax', async ({
  page,
}) => {
  await waitForApp(page);
  await openFixture(page, 'golden/portrait.png');
  // synthetische Tiefe: links nah, rechts fern; linke Hälfte als Segment „Links“
  const layerId = await page.evaluate(async () => {
    const bls = window.__bls;
    const p = bls.getProject();
    const layer = p?.root.children[0];
    const o = p ? Object.values(p.originals)[0] : undefined;
    if (!p || !layer || !o) throw new Error('kein Projekt');
    const w = 64;
    const h = Math.round((64 * o.height) / o.width);
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = x / (w - 1);
    await bls.ml.injectMap(o.id, 'depth', d, w, h);
    const { width: cw, height: ch } = p.canvas;
    const sid = bls.commands.beginStroke();
    bls.commands.paintStrokeCommand(
      layer.id,
      'selection',
      {
        mode: 'add',
        size: cw * 0.5,
        softness: 0,
        flow: 1,
        pressure: false,
        points: [cw * 0.25, -ch, 1, cw * 0.25, ch * 2, 1],
      },
      sid,
      false,
    );
    bls.commands.saveSelectionAsSegmentCommand(layer.id, 'Links');
    bls.commands.clearPaintCommand(layer.id, 'selection');
    bls.store.getState().select(layer.id);
    return layer.id;
  });
  const original = await renderExport(page);
  const historyBefore = await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0);

  // Dialog über den Inspektor öffnen
  if (!(await page.getByTestId('style-regions-open').count()))
    await page.getByTestId('segment-section').getByRole('button', { name: 'Segmente' }).click();
  await page.getByTestId('style-regions-open').click();
  const dialog = page.getByTestId('style-regions-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('region-row')).toHaveCount(2);
  await dialog.getByTestId('region-style-rest').selectOption('fx:black-white');
  const segId = await page.evaluate(() => window.__bls.getProject()?.segments?.[0]?.id ?? '');
  await dialog.getByTestId(`region-style-${segId}`).selectOption('fx:color-overlay');
  await dialog.getByTestId('region-apply').click();
  await expect(dialog).toBeHidden();

  const g = await page.evaluate(() => {
    const root = window.__bls.getProject()?.root;
    const group = root?.children[0];
    if (group?.kind !== 'group') return null;
    return {
      name: group.name,
      origin: group.origin?.kind,
      kids: group.children.map((c) => ({
        name: c.name,
        fx: c.effects.map((e) => e.effectId),
        mask: c.kind === 'layer' ? c.mask.kind : '',
        strokes: c.kind === 'layer' ? (c.maskStrokes?.length ?? 0) : 0,
      })),
    };
  });
  expect(g?.name).toBe('Stil je Bereich');
  expect(g?.origin).toBe('style-regions');
  expect(g?.kids.map((k) => k.fx)).toEqual([['black-white'], ['color-overlay']]);
  // Segment aus dem Pinsel: leere Grundmaske + Striche
  expect(g?.kids[1]).toMatchObject({ mask: 'empty', strokes: 1 });
  // genau ein Undo-Schritt
  expect(await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0)).toBe(
    historyBefore + 1,
  );

  // Tiefe der Bereichsebenen (Parallax): Segment links nah, Hintergrund (rechts) fern
  await expect
    .poll(() =>
      page.evaluate(() => {
        const group = window.__bls.getProject()?.root.children[0];
        return group?.kind === 'group'
          ? group.children.map((c) => (c.kind === 'layer' ? (c.depth ?? null) : null))
          : [];
      }),
    )
    .not.toContain(null);
  const depths = await page.evaluate(() => {
    const group = window.__bls.getProject()?.root.children[0];
    return group?.kind === 'group'
      ? group.children.map((c) => (c.kind === 'layer' ? (c.depth ?? -1) : -1))
      : [];
  });
  expect(depths[1] ?? 1).toBeLessThan(0.35);
  expect(depths[0] ?? 0).toBeGreaterThan(0.6);

  // Bild: links eingefärbt (Segment), rechts schwarz-weiß (Hintergrund)
  const styled = await renderExport(page);
  const at = (img: typeof styled, fx: number) => {
    const i = (Math.floor(img.height * 0.5) * img.width + Math.floor(fx * img.width)) * 4;
    return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
  };
  const right = at(styled, 0.85);
  expect(Math.max(...right) - Math.min(...right)).toBeLessThanOrEqual(2); // grau
  expect(at(styled, 0.15)).not.toEqual(at(original, 0.15));

  // Undo stellt die Ebene wieder her
  await page.getByTestId('undo').click();
  expect(await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id)).toBe(layerId);
});
