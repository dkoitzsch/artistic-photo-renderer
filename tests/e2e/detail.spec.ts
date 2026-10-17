// E1 Schritt 16: Beim Hineinzoomen über die Vorschau-Auflösung hinaus rendert die Engine den sichtbaren Ausschnitt in
// voller Leinwandauflösung nach; das Ergebnis gleicht dem Export.

import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { addEffect, renderExport, settle, waitForApp, waitForProject } from './helpers';

const W = 3000;
const H = 2000;
const OFF = 1000; // Leinwand-px am linken/oberen Rand der Ansicht

async function openStripes(page: Page, path: string) {
  // 1-px-Streifen mit langsamem Verlauf: in der Vorschau (Faktor 0,68) verschwimmen sie zu Grau
  const img = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = x & 1 ? 230 : 25;
      img.data[i] = v;
      img.data[i + 1] = (y * 255) / H;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  writeFileSync(path, PNG.sync.write(img));
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(path);
  await waitForProject(page);
}

/** Ansicht 100 % (1 CSS-px = 1 Leinwand-px), Ausschnitt ab (OFF, OFF). */
async function zoom100(page: Page) {
  await page.evaluate((off) => {
    window.__bls.store.getState().setView({ zoom: 1, offsetX: -off, offsetY: -off });
  }, OFF);
}

const shot = async (page: Page) => {
  await settle(page);
  return PNG.sync.read(await page.getByTestId('canvas').screenshot());
};

/** mittlere Abweichung benachbarter Pixel (Rot) im Bildmittelteil: hoch = Streifen sichtbar */
function stripeContrast(png: PNG): number {
  let sum = 0;
  let n = 0;
  for (let y = 100; y < 200; y++)
    for (let x = 100; x < 300; x++) {
      const i = (y * png.width + x) * 4;
      sum += Math.abs((png.data[i] ?? 0) - (png.data[i + 4] ?? 0));
      n++;
    }
  return sum / n;
}

const detailInfo = (page: Page) => page.evaluate(() => window.__bls.getEngine()?.detailInfo() ?? null);

test('Ausschnitt in voller Auflösung beim Hineinzoomen, gleich dem Export', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await waitForApp(page);
  await openStripes(page, testInfo.outputPath('stripes.png'));
  await zoom100(page);
  await expect.poll(() => detailInfo(page)).not.toBeNull();
  const detail = await detailInfo(page);
  // sichtbarer Bereich liegt im Ausschnitt
  expect(detail?.rect.x).toBeLessThanOrEqual(OFF);
  expect(detail?.rect.y).toBeLessThanOrEqual(OFF);
  const sharp = await shot(page);
  expect(stripeContrast(sharp)).toBeGreaterThan(150);

  // ohne Ausschnitt: nur Vorschau-Pixel (Streifen verschwimmen)
  await page.evaluate(() => {
    const e = window.__bls.getEngine();
    if (e) e.detailEnabled = false;
    window.__bls.store.getState().bumpRenderTick();
  });
  await expect.poll(() => detailInfo(page)).toBeNull();
  expect(stripeContrast(await shot(page))).toBeLessThan(60);
  await page.evaluate(() => {
    const e = window.__bls.getEngine();
    if (e) e.detailEnabled = true;
    window.__bls.store.getState().bumpRenderTick();
  });

  // Effekt: Ausschnitt wird bei jeder Änderung verworfen und danach neu gerendert; Pixel = Export
  await addEffect(page, 'pixelate', { size: 5 });
  await expect.poll(() => detailInfo(page)).not.toBeNull();
  const view = await shot(page);
  const exp = await renderExport(page);
  let worst = 0;
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 400; x++) {
      const i = (y * view.width + x) * 4;
      const j = ((y + OFF) * W + x + OFF) * 4;
      for (let c = 0; c < 3; c++)
        worst = Math.max(worst, Math.abs((view.data[i + c] ?? 0) - (exp.data[j + c] ?? 0)));
    }
  expect(worst).toBeLessThanOrEqual(2);

  // Herauszoomen (Bild eingepasst): kein Ausschnitt
  await page.keyboard.press('Meta+0');
  await expect.poll(() => detailInfo(page)).toBeNull();
});
