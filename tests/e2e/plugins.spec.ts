// Abnahme Phase 1: Ein neu angelegter Effekt-Ordner erscheint ohne Codeänderung im Effekt-Browser.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { canvasPixel, expectColor, openFixture, waitForApp, waitForProject } from './helpers';

const EFFECTS = new URL('../../effects/', import.meta.url).pathname;
const GOOD = `${EFFECTS}zz-e2e-invert`;
const BROKEN = `${EFFECTS}zz-e2e-broken`;

test.afterEach(() => {
  rmSync(GOOD, { recursive: true, force: true });
  rmSync(BROKEN, { recursive: true, force: true });
});

test('neuer Effekt-Ordner erscheint ohne Codeänderung; Fehler werden angezeigt', async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);

  // Zur Laufzeit angelegt – der Kern wird nicht angefasst.
  mkdirSync(GOOD, { recursive: true });
  writeFileSync(
    `${GOOD}/manifest.json`,
    JSON.stringify({
      id: 'zz-e2e-invert',
      name: 'E2E Invertieren',
      version: '1.0.0',
      category: 'Test',
      inputs: ['source'],
      passes: 1,
      params: [{ key: 'amount', label: 'Stärke', type: 'float', min: 0, max: 100, default: 100, unit: '%' }],
    }),
  );
  writeFileSync(
    `${GOOD}/effect.wgsl`,
    `fn effect(p: vec2i) -> vec4f {
  let c = unpremultiply(load_src(p));
  let inv = srgb_to_linear(vec3f(1.0) - linear_to_srgb(c.rgb));
  return premultiply(vec4f(mix(c.rgb, inv, params.amount / 100.0), c.a));
}
`,
  );
  mkdirSync(BROKEN, { recursive: true });
  writeFileSync(
    `${BROKEN}/manifest.json`,
    JSON.stringify({
      id: 'zz-e2e-broken',
      name: 'E2E Kaputt',
      version: '1.0.0',
      category: 'Test',
      inputs: ['source'],
      passes: 1,
      params: [],
    }),
  );
  writeFileSync(`${BROKEN}/effect.wgsl`, 'fn effect(p: vec2i) -> vec4f {\n  return gibt_es_nicht(p);\n}\n');

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const p = (window as Partial<Window>).__bls?.plugins.getState().plugins['zz-e2e-invert'];
          return p?.status === 'error' ? p.errors.join(' | ') : p?.status;
        }),
      {
        timeout: 15_000,
      },
    )
    .toBe('ok');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as Partial<Window>).__bls?.plugins.getState().plugins['zz-e2e-broken']?.status,
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe('error');

  // Vite lädt die Seite bei neu angelegten Dateien teils selbst neu (die App öffnet das Projekt dann wieder).
  // Für einen eindeutigen Zustand hier einmal bewusst neu laden.
  await page.reload();
  await waitForProject(page);
  await page.getByTestId('add-effect').click();
  await expect(page.getByTestId('effect-error-zz-e2e-broken')).toContainText('Zeile 2');
  await page.getByTestId('effect-tile-zz-e2e-invert').click();
  await expect(page.getByTestId('effect-card-zz-e2e-invert')).toBeVisible();
  expectColor(await canvasPixel(page), [225, 95, 35]);

  // Shader ändern → Hot Reload: Effekt rechnet sofort neu (hier: nur Rotkanal invertieren)
  writeFileSync(
    `${GOOD}/effect.wgsl`,
    `fn effect(p: vec2i) -> vec4f {
  let c = unpremultiply(load_src(p));
  let s = linear_to_srgb(c.rgb);
  return premultiply(vec4f(srgb_to_linear(vec3f(1.0 - s.r, s.g, s.b)), c.a));
}
`,
  );
  await expect.poll(async () => (await canvasPixel(page))[1], { timeout: 15_000 }).toBeGreaterThan(150);
  expectColor(await canvasPixel(page), [225, 160, 220]);

  // Projekt hat seinen Zustand über das Plugin-Neuladen behalten
  expect(await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects.length)).toBe(1);
});
