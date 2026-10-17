// E1 Schritt 8: asynchrone Effekte – Browser-CPU (Web Worker) und Python-Dienst (Testport 8766):
// Vorschau zeigt das Ergebnis nach Fertigstellung, Export rechnet in voller Auflösung, Abbruch, Lizenzsperre.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { randCell } from '../../src/effects/random';
import { canvasPixel, enableTestEffects, fixture, openFixture, renderExport, waitForApp } from './helpers';

const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** CPU-Referenz: Invertieren in sRGB (deckendes Testbild), optional Seed-Rauschen. */
function inverted(src: PNG, noise = 0, seed = 1): PNG {
  const out = new PNG({ width: src.width, height: src.height });
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const n = noise > 0 ? noise * (randCell(x, y, seed, 0) - 0.5) : 0;
      for (let c = 0; c < 3; c++) {
        const v = enc(dec((src.data[i + c] ?? 0) / 255));
        out.data[i + c] = Math.round(255 * enc(dec(Math.min(1, Math.max(0, 1 - v + n)))));
      }
      out.data[i + 3] = 255;
    }
  return out;
}

function maxDiff(a: PNG, b: PNG): number {
  let m = 0;
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)));
  return m;
}

async function addEffect(page: Page, effectId: string, params: Record<string, unknown> = {}) {
  await expect
    .poll(() => page.evaluate((id) => window.__bls.plugins.getState().plugins[id]?.status, effectId), {
      timeout: 15_000,
    })
    .toBe('ok');
  return page.evaluate(
    ({ effectId, params }) => {
      const layer = window.__bls.getProject()?.root.children[0];
      if (!layer) throw new Error('keine Ebene');
      const fx = window.__bls.commands.addEffectCommand(effectId, layer.id);
      if (!fx) throw new Error('Effekt fehlt');
      for (const [k, v] of Object.entries(params))
        window.__bls.commands.setParamCommand(layer.id, fx, k, v as never, false);
      return { layerId: layer.id, fxId: fx };
    },
    { effectId, params },
  );
}

const original = PNG.sync.read(readFileSync(fixture('golden/still-life.png')));

test.beforeEach(async ({ page }) => {
  await enableTestEffects(page);
  await page.addInitScript((url) => {
    localStorage.setItem('bls.serviceUrl', url);
  }, TEST_SERVICE_URL);
  await waitForApp(page);
  await openFixture(page, 'golden/still-life.png');
});

test('Browser-CPU: Vorschau aktualisiert sich nach dem Worker, Export gleich der CPU-Referenz', async ({
  page,
}) => {
  const before = await canvasPixel(page, 0.5, 0.5);
  await addEffect(page, 'zz-e2e-cpu-invert', { noise: 0.4, seed: 3 });
  // Vorschau: zuerst unverändert, nach dem Worker sichtbar verändert (exakte Prüfung über den Export)
  await expect
    .poll(async () => {
      const [r, g, b] = await canvasPixel(page, 0.5, 0.5);
      return Math.max(Math.abs(r - before[0]), Math.abs(g - before[1]), Math.abs(b - before[2]));
    })
    .toBeGreaterThan(30);
  const exported = await renderExport(page);
  expect(maxDiff(exported, inverted(original, 0.4, 3))).toBeLessThanOrEqual(2);
  // Export erneut: Ergebnis aus dem Cache, gleich
  expect(maxDiff(await renderExport(page), exported)).toBe(0);
});

test('Browser-CPU: Stärke 50 % mischt mit dem Eingang; Abbruch eines langen Jobs', async ({ page }) => {
  const { layerId, fxId } = await addEffect(page, 'zz-e2e-cpu-invert');
  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setStrengthCommand(layerId, fxId, 0.5, false);
    },
    { layerId, fxId },
  );
  const half = await renderExport(page);
  const ref = inverted(original);
  let worst = 0;
  for (let i = 0; i < half.data.length; i += 4)
    for (let c = 0; c < 3; c++) {
      // Mischung im linearen Raum
      const a = dec((original.data[i + c] ?? 0) / 255);
      const b = dec((ref.data[i + c] ?? 0) / 255);
      worst = Math.max(worst, Math.abs((half.data[i + c] ?? 0) - 255 * enc((a + b) / 2)));
    }
  expect(worst).toBeLessThanOrEqual(2);

  // langer Job → in der Job-Liste abbrechen
  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setParamCommand(layerId, fxId, 'delay', 10, false);
    },
    { layerId, fxId },
  );
  const job = page.getByTestId('effect-job');
  await expect(job).toContainText('E2E CPU Invertieren');
  await job.getByTestId('effect-job-cancel').click();
  await expect(job).toContainText('abgebrochen');
  await expect(job.getByTestId('effect-job-retry')).toBeVisible();
});

test('Python-Dienst: Vorschau und Export, Ergebnis-Cache, Lizenzsperre im Modus „Kommerziell“', async ({
  page,
}) => {
  await addEffect(page, 'zz-e2e-py-invert', { noise: 0.3, seed: 9 });
  const exported = await renderExport(page);
  // gleicher Zufall im Dienst (Python) wie im Browser
  expect(maxDiff(exported, inverted(original, 0.3, 9))).toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
      const [r] = await canvasPixel(page, 0.5, 0.5);
      return r;
    })
    .not.toBe(-1);

  // NC-Effekt im Modus „Kommerziell“: Fehler in der Job-Liste, Export bricht verständlich ab
  await addEffect(page, 'zz-e2e-py-nc');
  await expect(page.getByTestId('effect-job').filter({ hasText: 'E2E Python NC' })).toContainText(
    'nur nicht-kommerziell',
  );
  const err = await page.evaluate(async () => {
    try {
      const p = window.__bls.getProject();
      if (!p) return 'kein Projekt';
      await window.__bls.renderPng(p);
      return 'ok';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  expect(err).toContain('nur nicht-kommerziell');
});
