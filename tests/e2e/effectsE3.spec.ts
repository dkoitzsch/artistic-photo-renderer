// E3: Griff für Punkt-Parameter (Lichtquelle von „Neu beleuchten“ ziehen), Stilübertragung (klassisch) mit Stilbild.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { compareGolden } from './effectGolden';
import { diffStats, fixture, openFixture, renderExport, waitForApp } from './helpers';

test('Lichtquelle per Griff ziehen: Parameter folgt, ein Undo-Schritt, Bild ändert sich', async ({
  page,
}) => {
  await waitForApp(page);
  await openFixture(page, 'golden/portrait.png');
  // synthetische Tiefe: Scheibe in der Mitte nah
  const { layerId, fxId } = await page.evaluate(async () => {
    const bls = window.__bls;
    const p = bls.getProject();
    const o = p ? Object.values(p.originals)[0] : undefined;
    const layer = p?.root.children[0];
    if (!o || !layer) throw new Error('kein Projekt');
    const w = 96;
    const h = Math.round((96 * o.height) / o.width);
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) d[y * w + x] = Math.min(1, Math.hypot(x / w - 0.5, y / h - 0.5) * 2);
    await bls.ml.injectMap(o.id, 'depth', d, w, h);
    const fxId = bls.commands.addEffectCommand('relight', layer.id);
    if (!fxId) throw new Error('relight fehlt');
    bls.store.getState().select(layer.id);
    return { layerId: layer.id, fxId };
  });
  const before = await renderExport(page);
  const historyBefore = await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0);
  const handle = page.getByTestId('point-handle-light');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!box || !canvas) throw new Error('kein Griff');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.7, { steps: 6 });
  await page.mouse.up();
  const light = await page.evaluate(
    ({ layerId, fxId }) => {
      const l = window.__bls.getProject()?.root.children.find((n) => n.id === layerId);
      return l?.effects.find((e) => e.instanceId === fxId)?.params.light;
    },
    { layerId, fxId },
  );
  const cw = await page.evaluate(() => window.__bls.getProject()?.canvas.width ?? 0);
  expect(Array.isArray(light) && (light[0] as number) > cw * 0.5).toBe(true);
  expect(await page.evaluate(() => window.__bls.store.getState().history?.index ?? 0)).toBe(
    historyBefore + 1,
  );
  const after = await renderExport(page);
  // rechts unten heller als vorher, links oben dunkler
  const lum = (img: typeof after, fx: number, fy: number) => {
    const i = (Math.floor(fy * img.height) * img.width + Math.floor(fx * img.width)) * 4;
    return (img.data[i] ?? 0) + (img.data[i + 1] ?? 0) + (img.data[i + 2] ?? 0);
  };
  expect(lum(after, 0.75, 0.7)).toBeGreaterThan(lum(before, 0.75, 0.7));
  expect(lum(after, 0.15, 0.15)).toBeLessThan(lum(before, 0.15, 0.15));
});

test('Stil übertragen (klassisch): Stilbild laden mit Hinweis, Farben wandern zum Stil, Golden', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await waitForApp(page);
  await openFixture(page, 'golden/portrait.png');
  const original = await renderExport(page);
  await page.evaluate(() => {
    const layer = window.__bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    window.__bls.store.getState().select(layer.id);
    if (!window.__bls.commands.addEffectCommand('style-match', layer.id))
      throw new Error('style-match fehlt');
  });
  // ohne Stilbild unverändert
  expect(diffStats(original, await renderExport(page)).max).toBeLessThanOrEqual(1);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('param-style-load').click();
  await (await chooser).setFiles(fixture('golden/landscape.png'));
  await expect(page.getByText('Hinweis zum Stilbild').first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.style))
    .not.toBe('');
  const styled = await renderExport(page);
  compareGolden('style-match-portrait', styled, testInfo, { max: 2, mean: 0.1 });
  // Landschaft ist blau-grau: mittlerer Blauanteil steigt, Rot sinkt (Porträt ist warm)
  const meanCh = (img: typeof styled, c: number) => {
    let s = 0;
    for (let i = c; i < img.data.length; i += 4) s += img.data[i] ?? 0;
    return s / (img.data.length / 4);
  };
  expect(meanCh(styled, 2) - meanCh(styled, 0)).toBeGreaterThan(
    meanCh(original, 2) - meanCh(original, 0) + 5,
  );
});

test.describe('Stil übertragen (KI, AdaIN) im Test-Dienst', () => {
  const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
  test.skip(
    !existsSync(`${CACHE}decoder.pth`) || !existsSync(`${CACHE}vgg_normalised.pth`),
    'AdaIN-Gewichte fehlen im Test-Cache (npm run models:fetch)',
  );

  test('nur im Modus „Alle“; mit Stilbild im Dienst gerendert', async ({ page }) => {
    test.setTimeout(180_000);
    // Gewichte in den Cache des Test-Dienstes legen (wie nach einem Download im Dialog „Modelle“)
    const dir = join(tmpdir(), 'bls-e2e-service-cache', 'models', 'adain');
    mkdirSync(dir, { recursive: true });
    for (const f of ['decoder.pth', 'vgg_normalised.pth']) copyFileSync(`${CACHE}${f}`, join(dir, f));
    writeFileSync(join(dir, '.complete'), 'v0.0.0');
    await page.addInitScript((url) => {
      localStorage.setItem('bls.serviceUrl', url);
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    }, TEST_SERVICE_URL);
    await waitForApp(page);
    await openFixture(page, 'golden/portrait.png');
    const layerId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
    // im Modus „Kommerziell“ gesperrt
    expect(
      await page.evaluate((id) => window.__bls.commands.addEffectCommand('style-transfer', id), layerId),
    ).toBeNull();
    await page.evaluate(() => {
      window.__bls.store.getState().setLicenseMode('all');
    });
    const original = await renderExport(page);
    const fxId = await page.evaluate(
      (id) => window.__bls.commands.addEffectCommand('style-transfer', id),
      layerId,
    );
    expect(fxId).not.toBeNull();
    // Stilbild als Original ins Projekt laden und setzen
    await page.evaluate(() => {
      window.__bls.store.getState().select(window.__bls.getProject()?.root.children[0]?.id ?? null);
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('param-style-load').click();
    await (await chooser).setFiles(fixture('golden/landscape.png'));
    await expect(page.getByText('Hinweis zum Stilbild').first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.style))
      .not.toBe('');
    const styled = await renderExport(page);
    const d = diffStats(original, styled);
    expect(d.mean).toBeGreaterThan(10);
    // NC-Warnung beim Export: der Effekt steht in der Liste
    const nc = await page.evaluate(() =>
      window.__bls.ml.split.ncLayers(window.__bls.getProject() ?? ({} as never)),
    );
    expect(nc.some((x) => x.modelId === 'Effekt style-transfer')).toBe(true);
  });
});
