// E1 Schritt 9: Palette aus dem Bild der Ebene gewinnen (Posterisierung).
import { expect, test } from '@playwright/test';
import { openFixture, waitForApp } from './helpers';

test('Palette „Aus Ebene“ übernimmt Farben aus dem Original (gleiche Anzahl)', async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);
  const palette = () =>
    page.evaluate(
      () => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.palette as number[][],
    );
  await page.evaluate(() => {
    const layer = window.__bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    window.__bls.store.getState().select(layer.id);
    window.__bls.commands.addEffectCommand('posterize-palette', layer.id);
  });
  const before = await palette();
  await page.getByTestId('param-palette-from-layer').click();
  await expect.poll(palette).not.toEqual(before);
  const after = await palette();
  expect(after.length).toBe(before.length);
  // Das synthetische Bild enthält ein Blau (30, 160, 220): eine Palettenfarbe liegt nahe daran
  const near = after.some(
    ([r = 0, g = 0, b = 0]) =>
      Math.abs(r * 255 - 30) + Math.abs(g * 255 - 160) + Math.abs(b * 255 - 220) < 40,
  );
  expect(near).toBe(true);
  // ein Undo-Schritt
  await page.keyboard.press('Meta+z');
  expect(await palette()).toEqual(before);
});
