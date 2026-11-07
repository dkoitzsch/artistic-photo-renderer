// Phase 6: Aufteilen in Objekte (Modus 3) mit SAM 2.1 Tiny im Browser (Modell aus tests/.cache/models über den lokalen
// Spiegel). Bild: zwei klar getrennte, farbige Flächen auf ruhigem Grund.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { renderExport, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModel = [
  'sam2.1-tiny-vision_encoder_fp16.onnx',
  'sam2.1-tiny-vision_encoder_fp16.onnx_data',
  'sam2.1-tiny-prompt_encoder_mask_decoder_fp16.onnx',
  'sam2.1-tiny-prompt_encoder_mask_decoder_fp16.onnx_data',
].every((f) => existsSync(CACHE + f));

const W = 384;
const H = 256;

function scene(): PNG {
  const img = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = [150, 170, 190];
      if ((x - 110) ** 2 + (y - 120) ** 2 < 60 ** 2) c = [200, 40, 40];
      if (Math.abs(x - 280) < 55 && Math.abs(y - 130) < 70) c = [30, 120, 60];
      img.data[i] = c[0] ?? 0;
      img.data[i + 1] = c[1] ?? 0;
      img.data[i + 2] = c[2] ?? 0;
      img.data[i + 3] = 255;
    }
  return img;
}

test.describe('Objekte aufteilen (mit Modell)', () => {
  test.skip(!hasModel, 'SAM fehlt im Test-Cache (npm run models:fetch)');

  test('findet die Objekte, baut die Gruppe „Objekte“, Ergebnis ≈ Original, Rückgängig', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(240_000);
    await context.addInitScript(() => {
      localStorage.setItem('bls.modelMirror', '/__models/');
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    });
    await waitForApp(page);
    const file = testInfo.outputPath('szene.png');
    const original = scene();
    writeFileSync(file, PNG.sync.write(original));
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(file);
    await waitForProject(page);

    const layerId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
    const t0 = Date.now();
    const count = await page.evaluate((id) => window.__bls.ml.splitObjects(id, 6), layerId);
    const ms = Date.now() - t0;
    console.log(
      `Objekte im Browser (SAM Tiny, 8 × 8 Punkte, inkl. Modell laden): ${count} Objekte in ${ms} ms`,
    );
    expect(count).toBeGreaterThanOrEqual(2);

    const info = await page.evaluate(() => {
      const g = window.__bls.getProject()?.root.children[0];
      if (g?.kind !== 'group') return null;
      return {
        name: g.name,
        origin: g.origin?.kind,
        kids: g.children.map((c) => ({
          name: c.name,
          kind: c.kind,
          visible: c.visible,
          holeFill: c.kind === 'layer' ? c.holeFill : null,
          mask: c.kind === 'layer' ? c.mask.kind : null,
          provenance: c.kind === 'layer' && c.mask.kind === 'stored' ? c.mask.provenance.modelId : null,
        })),
      };
    });
    expect(info?.name).toBe('Objekte');
    expect(info?.origin).toBe('sam-objects');
    expect(info?.kids.length).toBe(count + 2);
    expect(info?.kids[0]?.visible).toBe(false); // Original ausgeblendet
    expect(info?.kids[1]).toMatchObject({ name: 'Hintergrund', holeFill: true, mask: 'stored' });
    expect(info?.kids[2]?.provenance).toBe('sam2.1-tiny');

    // Ohne die vorgegebenen Weichzeichner ergibt die Summe der Ebenen wieder das Bild
    await page.evaluate(() => {
      const b = window.__bls;
      const g = b.getProject()?.root.children[0];
      if (g?.kind !== 'group') return;
      for (const c of g.children)
        for (const fx of c.effects) b.commands.removeEffectCommand(c.id, fx.instanceId);
    });
    const out = await renderExport(page);
    expect([out.width, out.height]).toEqual([W, H]);
    let sum = 0;
    for (let i = 0; i < out.data.length; i += 4)
      for (let k = 0; k < 3; k++) sum += Math.abs((out.data[i + k] ?? 0) - (original.data[i + k] ?? 0));
    expect(sum / (W * H * 3)).toBeLessThan(8);

    // Rückgängig (Effekte entfernen, Aufteilen): wieder eine einzelne Ebene
    const undo = page.getByTestId('undo');
    for (let i = 0; i < 40; i++) {
      const isLayer = await page.evaluate(
        () => window.__bls.getProject()?.root.children[0]?.kind === 'layer',
      );
      if (isLayer) break;
      await undo.click();
    }
    expect(await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.kind)).toBe('layer');
  });
});

const TINY_DIR = `${CACHE}sam2.1-hiera-tiny/`;
const LARGE_REVISION = '665f8e2ad61cf5f53d65644ff27c8ee525124610';

test.describe('Objekte aufteilen im Dienst', () => {
  test.skip(
    !existsSync(`${TINY_DIR}model.safetensors`),
    'SAM 2.1 Tiny (Dienst-Format) fehlt im Test-Cache (npm run models:fetch)',
  );

  test('Dienst (hier mit den Tiny-Gewichten unter der Kennung sam2.1-large) liefert Objekte', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const dir = join(tmpdir(), 'bls-e2e-service-cache', 'models', 'sam2.1-large');
    mkdirSync(dir, { recursive: true });
    for (const f of ['config.json', 'preprocessor_config.json', 'processor_config.json', 'model.safetensors'])
      copyFileSync(`${TINY_DIR}${f}`, join(dir, f));
    writeFileSync(join(dir, '.complete'), LARGE_REVISION);
    await page.addInitScript((url) => {
      localStorage.setItem('bls.serviceUrl', url);
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'service' }));
    }, TEST_SERVICE_URL);
    await waitForApp(page);
    const file = testInfo.outputPath('szene.png');
    writeFileSync(file, PNG.sync.write(scene()));
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(file);
    await waitForProject(page);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__bls.store
                .getState()
                .service.info?.models.some((m) => m.id === 'sam2.1-large' && m.available) ?? false,
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    const layerId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
    const count = await page.evaluate((id) => window.__bls.ml.splitObjects(id, 6), layerId);
    expect(count).toBeGreaterThanOrEqual(2);
    const model = await page.evaluate(() => {
      const g = window.__bls.getProject()?.root.children[0];
      const o = g?.kind === 'group' ? g.children[2] : undefined;
      return o?.kind === 'layer' && o.mask.kind === 'stored' ? o.mask.provenance.modelId : null;
    });
    expect(model).toBe('sam2.1-large');
  });
});
