// E1 Schritt 15: Effekt-Browser (Kennzeichen, Vorschau, Lizenzsperre), Parametergruppe „Erweitert“, NC-Export-Warnung.
import { expect, test } from '@playwright/test';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { enableTestEffects, openFixture, waitForApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await enableTestEffects(page);
  await page.addInitScript((url) => {
    localStorage.setItem('bls.serviceUrl', url);
  }, TEST_SERVICE_URL);
  await waitForApp(page);
  await openFixture(page, 'golden/still-life.png');
});

test('Kennzeichen, Live-Vorschau nur für GPU-Effekte, Sperre nicht-kommerzieller Effekte', async ({
  page,
}) => {
  await page.getByTestId('add-effect').click();
  const browser = page.getByTestId('effect-browser');
  await expect(browser.getByTestId('effect-tile-kuwahara')).toContainText('interaktiv');
  await expect(browser.getByTestId('effect-tile-kuwahara')).toContainText('Kanten');
  const lowPoly = browser.getByTestId('effect-tile-low-poly');
  await expect(lowPoly).toContainText('langsam');
  await expect(lowPoly).toContainText('CPU');
  await expect(lowPoly).toContainText('Dienst');
  // GPU-Effekt: Live-Vorschau (Ausschnitt in Originalauflösung); Worker-/Dienst-Effekt: Platzhalter
  await expect(browser.getByTestId('effect-tile-rgb-split').locator('canvas')).toBeVisible();
  await expect(lowPoly.locator('canvas')).toBeHidden();
  await expect(lowPoly.locator('img')).toBeVisible(); // festes Vorschaubild (preview.png)
  // nicht-kommerzieller Effekt im Modus „Kommerziell“ gesperrt
  const nc = browser.getByTestId('effect-tile-zz-e2e-py-nc');
  await expect(nc).toBeDisabled();
  await expect(nc).toContainText('nur im Lizenzmodus „Alle“');
  await expect(nc).toContainText('NC');
  // auch über den Befehl nicht hinzufügbar
  const id = await page.evaluate(() => window.__bls.commands.addEffectCommand('zz-e2e-py-nc'));
  expect(id).toBeNull();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__bls.store.getState().setLicenseMode('all');
  });
  await page.getByTestId('add-effect').click();
  await expect(page.getByTestId('effect-tile-zz-e2e-py-nc')).toBeEnabled();
});

test('Nicht-kommerzieller Effekt im Projekt löst die Export-Warnung aus', async ({ page }) => {
  await page.evaluate(() => {
    window.__bls.store.getState().setLicenseMode('all');
    const layer = window.__bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    window.__bls.commands.addEffectCommand('zz-e2e-py-nc', layer.id);
  });
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-warning')).toContainText('Effekt zz-e2e-py-nc');
});

test('Parametergruppe „Erweitert“ ist eingeklappt', async ({ page }) => {
  await page.evaluate(() => {
    const layer = window.__bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    window.__bls.store.getState().select(layer.id);
    window.__bls.commands.addEffectCommand('halftone-cmyk', layer.id);
  });
  const card = page.getByTestId('effect-card-halftone-cmyk');
  await expect(card.getByText('Rasterweite')).toBeVisible();
  await expect(card.getByText('Winkel Cyan')).toBeHidden();
  await card.getByTestId('param-group-Erweitert').locator('summary').click();
  await expect(card.getByText('Winkel Cyan')).toBeVisible();
});
