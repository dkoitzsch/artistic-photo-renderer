// Golden-Tests aller Effekte (Fälle in effectCases.ts, Prüfungen in effectGolden.ts).
import { test } from '@playwright/test';
import { EFFECT_CASES } from './effectCases';
import { checkEffect } from './effectGolden';
import { waitForApp } from './helpers';

for (const c of EFFECT_CASES) {
  test(`Effekt ${c.name}`, async ({ page }, testInfo) => {
    await waitForApp(page);
    await checkEffect(page, c, testInfo);
  });
}
