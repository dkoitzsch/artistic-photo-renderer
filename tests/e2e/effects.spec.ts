// Golden-Tests aller Effekte (Fälle in effectCases.ts, Prüfungen in effectGolden.ts).
import { test } from '@playwright/test';
import { EFFECT_CASES } from './effectCases';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { checkEffect } from './effectGolden';
import { waitForApp } from './helpers';

for (const c of EFFECT_CASES) {
  test(`Effekt ${c.name}`, async ({ page }, testInfo) => {
    // Effekte mit Endrender im Dienst (z. B. Low-Poly) nutzen den Testdienst
    await page.addInitScript((url) => {
      localStorage.setItem('bls.serviceUrl', url);
    }, TEST_SERVICE_URL);
    await waitForApp(page);
    await checkEffect(page, c, testInfo);
  });
}
