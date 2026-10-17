// E1 Schritt 5: Presets – mitgelieferte mit Live-Vorschau, eigene Effekt-Presets, Stapel-Presets,
// Speicherung über Neuladen hinweg, Export/Import.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fixture, openFixture, waitForApp } from './helpers';

const params = (page: Page, layerIndex = 0): Promise<Record<string, unknown>[] | undefined> =>
  page.evaluate(
    (i) => window.__bls.getProject()?.root.children[i]?.effects.map((e) => ({ id: e.effectId, ...e.params })),
    layerIndex,
  );

async function addEffect(page: Page, effectId: string, layerIndex = 0): Promise<string> {
  return page.evaluate(
    ({ effectId, layerIndex }) => {
      const layer = window.__bls.getProject()?.root.children[layerIndex];
      if (!layer) throw new Error('keine Ebene');
      window.__bls.store.getState().select(layer.id);
      const id = window.__bls.commands.addEffectCommand(effectId, layer.id);
      if (!id) throw new Error('Effekt fehlt');
      return id;
    },
    { effectId, layerIndex },
  );
}

test('Effekt- und Stapel-Presets: anwenden, sichern, behalten, exportieren, importieren', async ({
  page,
}) => {
  await waitForApp(page);
  await openFixture(page, 'golden/still-life.png');
  const layerId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
  const blurId = await addEffect(page, 'gaussian-blur');
  const card = page.getByTestId('effect-card-gaussian-blur');

  // Mitgelieferte Presets mit Live-Vorschaubild
  await card.getByTestId('preset-menu').click();
  const menu = card.getByTestId('preset-menu-menu');
  await expect(menu.getByRole('menuitem', { name: 'Stark' })).toBeVisible();
  await expect(menu.locator('.preset-thumb img').first()).toHaveAttribute('src', /^data:image\/jpeg/);
  await menu.getByRole('menuitem', { name: 'Stark' }).click();
  expect((await params(page))?.[0]?.radius).toBe(60);

  // Eigenes Preset sichern (mit Vorschaubild) und wieder anwenden
  await page.evaluate(
    ({ layerId, blurId }) => {
      window.__bls.commands.setParamCommand(layerId, blurId, 'radius', 33, false);
    },
    { layerId, blurId },
  );
  await card.getByTestId('preset-menu').click();
  await menu.getByTestId('effect-preset-name').fill('Mein Blur');
  await menu.getByTestId('effect-preset-save').click();
  await expect(menu.getByTestId('own-preset')).toHaveText(/Mein Blur/);
  await expect(menu.getByTestId('own-preset').locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
  await page.keyboard.press('Escape');
  await page.evaluate(
    ({ layerId, blurId }) => {
      window.__bls.commands.setParamCommand(layerId, blurId, 'radius', 5, false);
    },
    { layerId, blurId },
  );
  await card.getByTestId('preset-menu').click();
  await menu.getByTestId('own-preset').click();
  expect((await params(page))?.[0]?.radius).toBe(33);

  // Stapel aus Unschärfe + Dunst sichern und auf eine zweite Ebene anwenden
  await addEffect(page, 'haze');
  await page.getByTestId('stack-preset-menu').click();
  const stackMenu = page.getByTestId('stack-preset-menu-menu');
  await stackMenu.getByTestId('stack-preset-name').fill('Kombi');
  await stackMenu.getByTestId('stack-preset-save').click();
  await expect(stackMenu.getByTestId('stack-preset')).toHaveText(/Kombi/);
  await page.keyboard.press('Escape');

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  await (await chooser).setFiles(fixture('sharp-256x192.png'));
  await expect.poll(() => page.evaluate(() => window.__bls.getProject()?.root.children.length)).toBe(2);
  await page.getByTestId('stack-preset-menu').click();
  await stackMenu.getByTestId('stack-preset-replace').click();
  expect((await params(page, 1))?.map((e) => e.id)).toEqual(['gaussian-blur', 'haze']);
  expect((await params(page, 1))?.[0]?.radius).toBe(33);
  // ein Undo-Schritt
  await page.keyboard.press('Meta+z');
  expect(await params(page, 1)).toEqual([]);

  // Gespeichert über Neuladen hinweg
  await page.evaluate(() => window.__bls.presets.saved());
  await page.reload();
  await waitForApp(page);
  await expect.poll(() => page.evaluate(() => window.__bls.presets.store.getState().loaded)).toBe(true);
  const names = await page.evaluate(() => {
    const s = window.__bls.presets.store.getState();
    return { effects: s.effects.map((p) => p.name), stacks: s.stacks.map((p) => p.name) };
  });
  expect(names).toEqual({ effects: ['Mein Blur'], stacks: ['Kombi'] });

  // Export, alles löschen, Import
  await openFixture(page, 'golden/still-life.png');
  await addEffect(page, 'gaussian-blur');
  await page.getByTestId('stack-preset-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('presets-export').click();
  const file = readFileSync(await (await download).path(), 'utf8');
  expect(JSON.parse(file)).toMatchObject({ format: 'blur-layer-studio-presets', version: 1 });
  await page.evaluate(() => {
    window.__bls.presets.store.setState({ effects: [], stacks: [] });
  });
  await page.getByTestId('presets-import-file').setInputFiles({
    name: 'presets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file),
  });
  await expect
    .poll(() => page.evaluate(() => window.__bls.presets.store.getState().stacks.map((p) => p.name)))
    .toEqual(['Kombi']);
  // kaputte Datei → verständliche Meldung, Presets bleiben
  await page.getByTestId('presets-import-file').setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"anders"}'),
  });
  await expect(page.getByTestId('last-notice')).toContainText('Keine Preset-Datei');
  expect(await page.evaluate(() => window.__bls.presets.store.getState().effects.length)).toBe(1);
});
