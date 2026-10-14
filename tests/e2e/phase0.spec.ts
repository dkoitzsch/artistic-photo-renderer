import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { waitForProject } from './helpers';

const FIXTURE = new URL('../fixtures/synthetic-400x300.png', import.meta.url).pathname;

async function openFixture(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(FIXTURE);
  await waitForProject(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.statusbar-gpu')).toContainText('WebGPU ·');
});

test('WebGPU ist bereit, keine Fehlermeldung', async ({ page }) => {
  await expect(page.getByTestId('gpu-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('open-button')).toBeVisible();
});

test('Bild laden zeigt es eingepasst auf der Leinwand', async ({ page }) => {
  await openFixture(page);
  await expect(page.getByTestId('zoom-value')).not.toHaveText('–');
  await page.waitForTimeout(100);
  const shot = PNG.sync.read(await page.getByTestId('canvas').screenshot());
  // Leinwandmitte = Bildmitte = einfarbige Fläche (30, 160, 220)
  const i = (Math.floor(shot.height / 2) * shot.width + Math.floor(shot.width / 2)) * 4;
  const px = [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
  for (const [got, want] of px.map((v, k) => [v ?? -1, [30, 160, 220][k] ?? -1] as const)) {
    expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
  }
});

test('Zoom per Tastatur und Einpassen', async ({ page }) => {
  await openFixture(page);
  const fit = await page.getByTestId('zoom-value').textContent();
  await page.keyboard.press('Meta+1');
  await expect(page.getByTestId('zoom-value')).toHaveText('100 %');
  await page.keyboard.press('Meta+0');
  await expect(page.getByTestId('zoom-value')).toHaveText(fit ?? '');
});

test('PNG-Export entspricht dem Original (Golden)', async ({ page }) => {
  await openFixture(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-start').click();
  const file = await (await download).path();
  const got = PNG.sync.read(readFileSync(file));
  const want = PNG.sync.read(readFileSync(FIXTURE));
  expect([got.width, got.height]).toEqual([want.width, want.height]);

  // Pixelvergleich ohne expect pro Pixel (zu langsam); Abweichungen werden gezählt.
  let maxDiff = 0;
  let alphaMismatches = 0;
  let colorMismatches = 0;
  for (let i = 0; i < want.data.length; i += 4) {
    const a = want.data[i + 3] ?? 0;
    if ((got.data[i + 3] ?? 0) !== a) alphaMismatches++;
    if (a === 0) continue; // Farbe bei Alpha 0 ist undefiniert
    // Deckend: ±1; halbtransparent: ±2 (8-Bit-Vormultiplizieren im 2D-Canvas)
    const tol = a === 255 ? 1 : 2;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((got.data[i + c] ?? 0) - (want.data[i + c] ?? 0));
      maxDiff = Math.max(maxDiff, d);
      if (d > tol) colorMismatches++;
    }
  }
  expect(alphaMismatches).toBe(0);
  expect(colorMismatches).toBe(0);
  console.log(`Export: maximale Kanalabweichung ${maxDiff}`);
});

test('Theme-Umschalter wechselt und merkt sich die Wahl', async ({ page }) => {
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.getByTestId('theme-toggle').click();
  const after = before === 'dark' ? 'light' : 'dark';
  await expect(html).toHaveAttribute('data-theme', after);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after);
});
