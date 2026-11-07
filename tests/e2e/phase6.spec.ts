// Phase 6 (ohne Modelle): Echo-Versatz als Effekt, Modus „Objekte“ im Aufteilen-Dialog, LaMa-Schaltfläche im Inspektor.
import { expect, test } from '@playwright/test';
import { openFixture, waitForApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // kein Dienst, damit die Begründung „nicht erreichbar“ erscheint
    localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
  });
  await waitForApp(page);
  await openFixture(page, 'golden/portrait.png');
});

test('Aufteilen-Dialog bietet „Objekte“ mit Regler und Startknopf', async ({ page }) => {
  const id = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
  await page.evaluate((layerId) => {
    window.__bls.store.getState().openSplitDialog(layerId);
  }, id);
  await expect(page.getByTestId('split-dialog')).toBeVisible();
  await page.getByTestId('mode-objects').check();
  await expect(page.getByTestId('objects-max')).toBeVisible();
  await expect(page.getByTestId('objects-start')).toBeEnabled();
  await expect(page.getByTestId('split-dialog')).toContainText('SAM 2.1 Hiera Tiny im Browser');
});

test('LaMa-Schaltfläche ist ohne Dienst gesperrt und nennt den Grund', async ({ page }) => {
  // Ebene mit Lochfüllung: Aufteilen mit vorgegebener Maske
  await page.evaluate(async () => {
    const b = window.__bls;
    const top = b.getProject()?.root.children[0];
    if (!top) throw new Error('keine Ebene');
    const m = new Uint16Array(96 * 64);
    for (let i = 0; i < m.length; i++) m[i] = i % 96 > 30 && i % 96 < 70 ? 65535 : 0;
    await b.ml.splitWithMask(top.id, m, 96, 64);
    const g = b.getProject()?.root.children[0];
    if (g?.kind === 'group' && g.children[1]) b.store.getState().select(g.children[1].id);
  });
  const btn = page.getByTestId('inpaint-lama');
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('title', /ML-Modus „Browser“|nicht erreichbar/);
});

test('Echo-Versatz ist im Effektregister geladen', async ({ page }) => {
  const ok = await page.evaluate(
    () => window.__bls.plugins.getState().plugins['echo-offset']?.status === 'ok',
  );
  expect(ok).toBe(true);
});
