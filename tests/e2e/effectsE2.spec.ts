// E2: Verhalten neuer Effekte über die Golden-Bilder hinaus (Text-Parameter, globale Effekte im Export).
import { expect, test } from '@playwright/test';
import { addEffect, diffStats, openFixture, renderExport, waitForApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
});

test('ASCII: eigener Text über das Textfeld, Undo stellt ihn wieder her', async ({ page }) => {
  await openFixture(page, 'golden/still-life.png');
  const { layerId, instanceId } = await addEffect(page, 'ascii', { charset: 'text', cellSize: 14 });
  const before = await renderExport(page);
  const field = page.getByTestId('param-text').getByRole('textbox');
  await field.fill('ÄÖÜ ✓ Wasser');
  await field.press('Enter');
  const text = await page.evaluate(
    ({ layerId, instanceId }) => {
      const layer = window.__bls.getProject()?.root.children.find((n) => n.id === layerId);
      const fx = layer?.kind === 'layer' ? layer.effects.find((e) => e.instanceId === instanceId) : undefined;
      return fx?.params.text;
    },
    { layerId, instanceId },
  );
  expect(text).toBe('ÄÖÜ ✓ Wasser');
  const after = await renderExport(page);
  expect(diffStats(before, after).mean).toBeGreaterThan(1);
  await page.keyboard.press('Meta+z');
  await expect(field).toHaveValue('BLUR & LAYER STUDIO · ');
});

test('Datamosh: Blöcke sind kachelgenau, auch mit Verschiebung über Kachelgrenzen', async ({ page }) => {
  await openFixture(page, 'golden/architecture.png');
  await addEffect(page, 'datamosh', { blockSize: 20, smear: 60, amount: 60, quality: 30 });
  const whole = await renderExport(page);
  const tiled = await renderExport(page, 64);
  expect(diffStats(whole, tiled).max).toBe(0);
});
