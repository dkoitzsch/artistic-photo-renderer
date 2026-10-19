// E3: Griff für Punkt-Parameter (Lichtquelle von „Neu beleuchten“ ziehen) und Lichtverschiebung im Bild.

import { expect, test } from '@playwright/test';
import { openFixture, renderExport, waitForApp } from './helpers';

test('Lichtquelle per Griff ziehen: Parameter folgt, ein Undo-Schritt, Bild ändert sich', async ({
  page,
}) => {
  await waitForApp(page);
  await openFixture(page, 'golden/portrait.png');
  // synthetische Tiefe: Scheibe in der Mitte nah
  const { layerId, fxId } = await page.evaluate(async () => {
    const bls = window.__bls;
    const p = bls.getProject();
    const o = p ? Object.values(p.originals)[0] : undefined;
    const layer = p?.root.children[0];
    if (!o || !layer) throw new Error('kein Projekt');
    const w = 96;
    const h = Math.round((96 * o.height) / o.width);
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) d[y * w + x] = Math.min(1, Math.hypot(x / w - 0.5, y / h - 0.5) * 2);
    await bls.ml.injectMap(o.id, 'depth', d, w, h);
    const fxId = bls.commands.addEffectCommand('relight', layer.id);
    if (!fxId) throw new Error('relight fehlt');
    bls.store.getState().select(layer.id);
    return { layerId: layer.id, fxId };
  });
  const before = await renderExport(page);
  const historyBefore = await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0);
  const handle = page.getByTestId('point-handle-light');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!box || !canvas) throw new Error('kein Griff');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.7, { steps: 6 });
  await page.mouse.up();
  const light = await page.evaluate(
    ({ layerId, fxId }) => {
      const l = window.__bls.getProject()?.root.children.find((n) => n.id === layerId);
      return l?.effects.find((e) => e.instanceId === fxId)?.params.light;
    },
    { layerId, fxId },
  );
  const cw = await page.evaluate(() => window.__bls.getProject()?.canvas.width ?? 0);
  expect(Array.isArray(light) && (light[0] as number) > cw * 0.5).toBe(true);
  expect(await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0)).toBe(
    historyBefore + 1,
  );
  const after = await renderExport(page);
  // rechts unten heller als vorher, links oben dunkler
  const lum = (img: typeof after, fx: number, fy: number) => {
    const i = (Math.floor(fy * img.height) * img.width + Math.floor(fx * img.width)) * 4;
    return (img.data[i] ?? 0) + (img.data[i + 1] ?? 0) + (img.data[i + 2] ?? 0);
  };
  expect(lum(after, 0.75, 0.7)).toBeGreaterThan(lum(before, 0.75, 0.7));
  expect(lum(after, 0.15, 0.15)).toBeLessThan(lum(before, 0.15, 0.15));
});
