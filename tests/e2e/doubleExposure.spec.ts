// E1 Schritt 13: Doppelbelichtung mit Zweitbild (Parameter vom Typ "image").
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareGolden } from './effectGolden';
import { diffStats, fixture, openFixture, renderExport, waitForApp } from './helpers';

test('Doppelbelichtung: Zweitbild laden, Silhouette, Kacheln, Mischung gegen CPU', async ({
  page,
}, testInfo) => {
  await waitForApp(page);
  await openFixture(page, 'golden/portrait.png');
  const original = await renderExport(page);
  const { layerId, fxId } = await page.evaluate(() => {
    const layer = window.__bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    window.__bls.store.getState().select(layer.id);
    const fx = window.__bls.commands.addEffectCommand('double-exposure', layer.id);
    if (!fx) throw new Error('Effekt fehlt');
    return { layerId: layer.id, fxId: fx };
  });
  await expect
    .poll(() => page.evaluate(() => window.__bls.plugins.getState().plugins['double-exposure']?.status))
    .toBe('ok');
  // ohne Zweitbild unverändert
  expect(diffStats(original, await renderExport(page)).max).toBe(0);

  // Zweitbild am Parameter laden → Original im Projekt, Parameter gesetzt
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('param-image-load').click();
  await (await chooser).setFiles(fixture('golden/landscape.png'));
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.__bls.getProject()?.originals ?? {}).length))
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.image))
    .not.toBe('');
  const silhouette = await renderExport(page);
  compareGolden('double-exposure-silhouette-portrait', silhouette, testInfo, { max: 2, mean: 0.1 });
  expect(diffStats(silhouette, await renderExport(page, 64)).max).toBe(0);
  expect(diffStats(silhouette, original).mean).toBeGreaterThan(10);

  // „überall, Multiplizieren, 100 %“: Ergebnis = Grundbild × Zweitbild (sRGB); Zweitbild mit gleichem Seitenverhältnis?
  // Landschaft 384×216 füllt das Porträt 384×256 (Höhe passt, Breite beschnitten): Referenz per CPU berechnen
  await page.evaluate(
    ({ layerId, fxId }) => {
      const c = window.__bls.commands;
      c.setParamCommand(layerId, fxId, 'mask', 'all', false);
      c.setParamCommand(layerId, fxId, 'blend', 'multiply', false);
    },
    { layerId, fxId },
  );
  const got = await renderExport(page);
  const land = PNG.sync.read(readFileSync(fixture('golden/landscape.png')));
  const cover = Math.max(384 / land.width, 256 / land.height);
  let worst = 0;
  for (let y = 0; y < 256; y += 7)
    for (let x = 0; x < 384; x += 7) {
      // Texelkoordinate wie im Shader (Pixelmitte), bilinear
      const tx = (x + 0.5 - 192) / cover + land.width / 2 - 0.5;
      const ty = (y + 0.5 - 128) / cover + land.height / 2 - 0.5;
      const sample = (c: number) => {
        const lin = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const at = (ix: number, iy: number) =>
          lin(
            land.data[
              (Math.min(land.height - 1, Math.max(0, iy)) * land.width +
                Math.min(land.width - 1, Math.max(0, ix))) *
                4 +
                c
            ] ?? 0,
          );
        const ix = Math.floor(tx);
        const iy = Math.floor(ty);
        const fx = tx - ix;
        const fy = ty - iy;
        const v =
          (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) +
          (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
        return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      };
      const i = (y * 384 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const want = 255 * ((original.data[i + c] ?? 0) / 255) * sample(c);
        worst = Math.max(worst, Math.abs((got.data[i + c] ?? 0) - want));
      }
    }
  expect(worst).toBeLessThanOrEqual(3);
});
