// E3 Schritt 1: Analysekarten aus Modellen (depth, normals, saliency, faces) – automatisch berechnet, sobald ein Effekt
// sie braucht; je Original abgelegt, Undo entfernt sie nicht; Effektmaske aus Gesichtern; Projektdatei.

import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { PNG } from 'pngjs';
import { addEffect, enableTestEffects, fixture, renderExport, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModels =
  existsSync(`${CACHE}u2netp.onnx`) &&
  existsSync(`${CACHE}depth-anything-v2-small-fp16.onnx`) &&
  existsSync(`${CACHE}face_landmarker.task`);

/** Mittelwert des Rotkanals (0..255) in einem Rechteck (Anteile). */
function mean(img: PNG, x0: number, y0: number, x1: number, y1: number, ch = 0): number {
  let s = 0;
  let n = 0;
  for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++)
    for (let x = Math.floor(x0 * img.width); x < Math.floor(x1 * img.width); x++) {
      s += img.data[(y * img.width + x) * 4 + ch] ?? 0;
      n++;
    }
  return s / n;
}

async function maps(page: Page) {
  return page.evaluate(() => {
    const p = window.__bls.getProject();
    const id = Object.keys(p?.originals ?? {})[0] ?? '';
    const a = p?.analysis?.[id];
    return {
      depth: a?.depth?.provenance.modelId ?? null,
      saliency: a?.saliency?.provenance.modelId ?? null,
      faces: a?.faces?.faceCount ?? null,
    };
  });
}

test.describe('Analysekarten aus Modellen', () => {
  test.skip(!hasModels, 'Modelle fehlen im Test-Cache (npm run models:fetch)');

  test('werden für einen Effekt berechnet, bleiben bei Undo und wirken als Effektmaske', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await context.addInitScript(() => {
      localStorage.setItem('bls.modelMirror', '/__models/');
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    });
    if (process.env.DBG_NET) {
      context.on('requestfailed', (r) => {
        console.log('FAILED', r.url(), r.failure()?.errorText);
      });
      context.on('response', (r) => {
        if (r.url().includes('vendor') || r.url().includes('__models'))
          console.log('RESP', r.status(), r.url());
      });
    }
    await enableTestEffects(page);
    await waitForApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(fixture('photo-portrait-hand.jpg'));
    await waitForProject(page);
    const historyStart = await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0);

    const { layerId, instanceId } = await addEffect(page, 'zz-e2e-mlmaps', { show: 'saliency' });
    await expect
      .poll(() => maps(page), { timeout: 180_000 })
      .toEqual({ depth: 'depth-anything-v2-small', saliency: 'u2netp', faces: 1 });

    // Salienz: Person (Gesicht) deutlich über dem Hintergrund (linke obere Ecke)
    const sal = await renderExport(page);
    expect(mean(sal, 0.38, 0.28, 0.5, 0.42)).toBeGreaterThan(150);
    expect(mean(sal, 0.0, 0.0, 0.12, 0.12)).toBeLessThan(60);

    // Gesichter: Gesicht ja, Hand und Hintergrund nein
    await page.evaluate(
      ({ layerId, instanceId }) => {
        window.__bls.commands.setParamCommand(layerId, instanceId, 'show', 'faces', false);
      },
      { layerId, instanceId },
    );
    const faces = await renderExport(page);
    expect(mean(faces, 0.4, 0.3, 0.48, 0.4)).toBeGreaterThan(200);
    expect(mean(faces, 0.0, 0.0, 0.12, 0.12)).toBeLessThan(5);

    // Tiefe: Person näher (kleiner) als der Hintergrund
    await page.evaluate(
      ({ layerId, instanceId }) => {
        window.__bls.commands.setParamCommand(layerId, instanceId, 'show', 'depth', false);
      },
      { layerId, instanceId },
    );
    const depth = await renderExport(page);
    expect(mean(depth, 0.38, 0.28, 0.5, 0.42)).toBeLessThan(mean(depth, 0.0, 0.0, 0.12, 0.12) - 40);

    // Normalen: überwiegend zum Betrachter (z > 0), rechte Gesichtsseite zeigt eher nach rechts als die linke
    await page.evaluate(
      ({ layerId, instanceId }) => {
        window.__bls.commands.setParamCommand(layerId, instanceId, 'show', 'normals', false);
      },
      { layerId, instanceId },
    );
    const normals = await renderExport(page);
    expect(mean(normals, 0.3, 0.2, 0.6, 0.6, 2)).toBeGreaterThan(160);
    // rechte Wange (Bildmitte rechts) zeigt eher nach rechts als die linke (rot = x)
    expect(mean(normals, 0.5, 0.3, 0.56, 0.45, 0)).toBeGreaterThan(mean(normals, 0.32, 0.3, 0.38, 0.45, 0));

    // Undo bis zum Anfang: Karten bleiben im Projekt (kein Verlaufsschritt)
    while ((await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0)) > historyStart)
      await page.getByTestId('undo').click();
    expect(await maps(page)).toEqual({ depth: 'depth-anything-v2-small', saliency: 'u2netp', faces: 1 });

    // Effektmaske aus Gesichtern: Farbfläche nur auf dem Gesicht
    await page.evaluate((layerId) => {
      const c = window.__bls.commands;
      const id = c.addEffectCommand('color-overlay', layerId);
      if (!id) throw new Error('color-overlay fehlt');
      c.setEffectMaskCommand(
        layerId,
        id,
        { kind: 'map', map: 'faces', from: 0.5, to: 1, feather: 0.05, invert: false },
        false,
      );
    }, layerId);
    const before = await page.evaluate(() => window.__bls.getProject()?.root.children.length);
    expect(before).toBe(1);
    const masked = await renderExport(page);
    const orig = await (async () => {
      await page.getByTestId('undo').click();
      await page.getByTestId('undo').click();
      return renderExport(page);
    })();
    const diff = (x0: number, y0: number, x1: number, y1: number) =>
      Math.abs(mean(masked, x0, y0, x1, y1) - mean(orig, x0, y0, x1, y1));
    expect(diff(0.4, 0.3, 0.48, 0.4)).toBeGreaterThan(10);
    expect(diff(0.0, 0.0, 0.12, 0.12)).toBeLessThan(1);
  });
});
