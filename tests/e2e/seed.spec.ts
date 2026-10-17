// E1 Schritt 4: Seed. Ein Test-Effekt (randomized) gibt den Shader-Zufall als Grauwert aus; geprüft werden
// Reproduzierbarkeit, Seed-Abhängigkeit, Kachel-Gleichheit und Gleichheit mit der CPU-Implementierung.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { randCell } from '../../src/effects/random';
import { diffStats, openFixture, renderExport, waitForApp } from './helpers';

const DIR = new URL('../../effects/zz-e2e-seed/', import.meta.url).pathname;

test.beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    `${DIR}manifest.json`,
    JSON.stringify({
      id: 'zz-e2e-seed',
      name: 'E2E Zufall',
      version: '1.0.0',
      category: 'Test',
      inputs: ['source'],
      passes: 1,
      randomized: true,
      params: [],
    }),
  );
  writeFileSync(
    `${DIR}effect.wgsl`,
    `fn effect(p: vec2i) -> vec4f {
  let r = rand_at(canvas_pos(p), params.seed, 0u);
  return vec4f(vec3f(r), 1.0);
}
`,
  );
});

test.afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

async function addSeedEffect(page: Page): Promise<{ layerId: string; fxId: string }> {
  await expect
    .poll(() => page.evaluate(() => window.__bls.plugins.getState().plugins['zz-e2e-seed']?.status), {
      timeout: 15_000,
    })
    .toBe('ok');
  return page.evaluate(() => {
    const bls = window.__bls;
    const layer = bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    const fxId = bls.commands.addEffectCommand('zz-e2e-seed', layer.id);
    if (!fxId) throw new Error('Effekt fehlt');
    return { layerId: layer.id, fxId };
  });
}

const encode = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

test('Seed: reproduzierbar, abhängig vom Seed, kachelgleich und gleich der CPU-Implementierung', async ({
  page,
}) => {
  await waitForApp(page);
  await openFixture(page, 'golden/flat-gray.png');
  const { layerId, fxId } = await addSeedEffect(page);
  // automatisch ergänzter Seed-Parameter mit Standardwert 1
  expect(
    await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.seed),
  ).toBe(1);

  const a = await renderExport(page);
  expect(diffStats(a, await renderExport(page)).max).toBe(0);
  expect(diffStats(a, await renderExport(page, 64)).max).toBe(0);

  let worst = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const want = encode(randCell(x, y, 1, 0));
      worst = Math.max(worst, Math.abs((a.data[(y * a.width + x) * 4] ?? 0) - want));
    }
  expect(worst).toBeLessThanOrEqual(1.5);

  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setParamCommand(layerId, fxId, 'seed', 2, false);
    },
    { layerId, fxId },
  );
  const b = await renderExport(page);
  expect(diffStats(a, b).mean).toBeGreaterThan(20);

  // Würfel in der Effektkarte setzt einen neuen Seed (ein Undo-Schritt)
  await page.getByTestId('param-seed-roll').click();
  const rolled = await page.evaluate(
    () => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.seed,
  );
  expect(rolled).not.toBe(2);
  await page.keyboard.press('Meta+z');
  expect(
    await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.seed),
  ).toBe(2);
});
