import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  addEffect,
  canvasPixel,
  diffStats,
  expectColor,
  fixture,
  openFixture,
  renderExport,
  settle,
  waitForApp,
  waitForProject,
} from './helpers';
import { gaussianReference } from './reference';

const BLUE = [30, 160, 220];
const GOLDEN_DIR = new URL('../golden/', import.meta.url).pathname;

/** Vergleicht mit tests/golden/<name>.png; UPDATE_GOLDEN=1 schreibt die Referenz neu. */
function expectGolden(name: string, got: PNG, tol = 2): void {
  const path = `${GOLDEN_DIR}${name}.png`;
  if (process.env.UPDATE_GOLDEN || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, PNG.sync.write(got));
    console.log(`Golden geschrieben: ${name}.png`);
    return;
  }
  const want = PNG.sync.read(readFileSync(path));
  const d = diffStats(got, want);
  console.log(`Golden ${name}: max ${d.max}, Mittel ${d.mean.toFixed(3)}`);
  expect(d.max).toBeLessThanOrEqual(tol);
}

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
});

test('mitgelieferte Effekte laden ohne Fehler', async ({ page }) => {
  const plugins = await page.evaluate(() =>
    Object.values(window.__bls.plugins.getState().plugins).map((p) => [p.folder, p.status, p.errors.join()]),
  );
  expect(plugins).toEqual(
    expect.arrayContaining([
      ['black-white', 'ok', ''],
      ['color-overlay', 'ok', ''],
      ['gaussian-blur', 'ok', ''],
    ]),
  );
});

test('Effekt über den Browser hinzufügen, Undo und Redo', async ({ page }) => {
  await openFixture(page);
  expectColor(await canvasPixel(page), BLUE);

  await page.getByTestId('add-effect').click();
  await expect(page.getByTestId('effect-browser')).toBeVisible();
  await page.getByTestId('effect-tile-black-white').click();
  await expect(page.getByTestId('effect-card-black-white')).toBeVisible();
  const gray = await canvasPixel(page);
  expect(Math.abs(gray[0] - gray[1]) + Math.abs(gray[1] - gray[2])).toBeLessThanOrEqual(2);

  await page.keyboard.press('Meta+z');
  await expect(page.getByTestId('effect-card-black-white')).toHaveCount(0);
  expectColor(await canvasPixel(page), BLUE);

  await page.keyboard.press('Meta+Shift+z');
  await expect(page.getByTestId('effect-card-black-white')).toBeVisible();
  expectColor(await canvasPixel(page), gray);
});

test('Reglergeste ergibt genau einen History-Eintrag; Doppelklick setzt zurück', async ({ page }) => {
  await openFixture(page);
  await page.getByTestId('add-effect').click();
  await page.getByTestId('effect-tile-gaussian-blur').click();
  const entries = () => page.evaluate(() => window.__bls.store.getState().history?.entries.length ?? 0);
  const radius = () =>
    page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]?.params.radius as number);
  const before = await entries();

  const track = page.getByTestId('param-radius').getByRole('slider');
  const box = await track.boundingBox();
  if (!box) throw new Error('kein Regler');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + box.width * (0.2 + i * 0.06), box.y + box.height / 2);
  await page.mouse.up();

  expect(await entries()).toBe(before + 1);
  expect(await radius()).toBeGreaterThan(50);

  await track.dblclick();
  expect(await radius()).toBe(20);

  // Zahleneingabe
  const input = page.getByTestId('param-radius').getByRole('textbox');
  await input.fill('123.4');
  await input.press('Enter');
  expect(await radius()).toBe(123.4);
});

test('Effekt-Stack per Ziehen sortieren', async ({ page }) => {
  await openFixture(page);
  await addEffect(page, 'black-white');
  await addEffect(page, 'color-overlay');
  const order = () =>
    page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects.map((e) => e.effectId));
  expect(await order()).toEqual(['black-white', 'color-overlay']);

  // Karten zuklappen, damit beide sichtbar sind
  await page.getByTestId('effect-card-black-white').locator('.effect-card-title').click();
  await page.getByTestId('effect-card-color-overlay').locator('.effect-card-title').click();
  const handle = page.getByTestId('effect-card-color-overlay').locator('.drag-handle');
  const target = page.getByTestId('effect-card-black-white').locator('.effect-card-head');
  await handle.dragTo(target, { targetPosition: { x: 20, y: 2 } });
  expect(await order()).toEqual(['color-overlay', 'black-white']);
});

test('Vorher/Nachher zeigt links das Original', async ({ page }) => {
  await openFixture(page);
  await addEffect(page, 'black-white');
  await page.keyboard.press('\\');
  await expect(page.getByTestId('compare-handle')).toBeVisible();
  expectColor(await canvasPixel(page, 0.45, 0.5), BLUE);
  const right = await canvasPixel(page, 0.55, 0.5);
  expect(Math.abs(right[0] - right[2])).toBeLessThanOrEqual(2);
  await page.keyboard.press('\\');
  await expect(page.getByTestId('compare-handle')).toHaveCount(0);
});

test('Gauß-Blur entspricht der CPU-Referenz (Golden)', async ({ page }) => {
  await openFixture(page, 'sharp-256x192.png');
  const src = PNG.sync.read(readFileSync(fixture('sharp-256x192.png')));
  const { layerId, instanceId } = await addEffect(page, 'gaussian-blur', { radius: 6 });

  // kleiner Radius: direkte Faltung
  const small = diffStats(await renderExport(page), gaussianReference(src, 6));
  console.log(`Gauß r=6: max ${small.max}, Mittel ${small.mean.toFixed(3)}`);
  expect(small.max).toBeLessThanOrEqual(2);

  // großer Radius: Pyramide mit Varianzausgleich
  for (const r of [45, 90]) {
    await page.evaluate(
      ({ layerId, instanceId, r }) => {
        window.__bls.commands.setParamCommand(layerId, instanceId, 'radius', r, false);
      },
      { layerId, instanceId, r },
    );
    const d = diffStats(await renderExport(page), gaussianReference(src, r));
    console.log(`Gauß r=${r}: max ${d.max}, Mittel ${d.mean.toFixed(3)}`);
    expect(d.mean).toBeLessThanOrEqual(1.5);
    expect(d.max).toBeLessThanOrEqual(10);
  }
});

test('Schwarz-Weiß und Farb-Overlay (Golden)', async ({ page }) => {
  await openFixture(page);
  const bw = await addEffect(page, 'black-white', { red: 90, green: 20, blue: -10, contrast: 40, grain: 30 });
  expectGolden('black-white-redfilter', await renderExport(page));
  await page.evaluate(({ layerId, instanceId }) => {
    window.__bls.commands.removeEffectCommand(layerId, instanceId);
  }, bw);
  const modes = ['multiply', 'soft-light', 'hue'];
  const ov = await addEffect(page, 'color-overlay', { opacity: 70 });
  for (const mode of modes) {
    await page.evaluate(
      ({ layerId, instanceId, mode }) => {
        window.__bls.commands.setParamCommand(layerId, instanceId, 'mode', mode, false);
      },
      { ...ov, mode },
    );
    expectGolden(`color-overlay-${mode}`, await renderExport(page));
  }
  await page.evaluate(({ layerId, instanceId }) => {
    window.__bls.commands.setParamCommand(layerId, instanceId, 'duotone', true, false);
  }, ov);
  expectGolden('color-overlay-duotone', await renderExport(page));
});

test('gekachelter Export ist nahtlos', async ({ page }) => {
  await openFixture(page);
  await addEffect(page, 'gaussian-blur', { radius: 40 });
  await addEffect(page, 'black-white', { grain: 60, amount: 60 });
  await addEffect(page, 'color-overlay', { mode: 'soft-light' });
  const whole = await renderExport(page, 4096);
  const tiled = await renderExport(page, 96);
  const d = diffStats(whole, tiled);
  console.log(`Kacheln 96 px vs. ganz: max ${d.max}`);
  expect(d.max).toBeLessThanOrEqual(1);
});

test('Projekt speichert automatisch, übersteht Neuladen und erscheint in der Übersicht', async ({
  page,
  context,
}) => {
  await openFixture(page);
  await addEffect(page, 'black-white');
  await expect(page.getByTestId('save-state')).toHaveText('Gespeichert', { timeout: 5000 });

  // Neuladen desselben Tabs: zurück im Projekt
  await page.reload();
  await expect(page.getByTestId('effect-card-black-white')).toBeVisible();

  // Neuer Tab: Projektübersicht mit Miniatur
  page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('project-overview')).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await expect(page.getByTestId('project-card').locator('img')).toBeVisible();
  await page.getByTestId('project-card').locator('.project-open').click();
  await expect(page.getByTestId('effect-card-black-white')).toBeVisible();
  const gray = await canvasPixel(page);
  expect(Math.abs(gray[0] - gray[2])).toBeLessThanOrEqual(2);
});

test('Projektdatei sichern und wieder öffnen', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await waitForApp(page);
  await openFixture(page);
  await addEffect(page, 'gaussian-blur', { radius: 77 });
  await addEffect(page, 'color-overlay', { duotone: true });
  await page.getByRole('textbox', { name: 'Projektname' }).fill('Rundreise');
  const original = await page.evaluate(() => window.__bls.getProject());

  const download = page.waitForEvent('download');
  await page.getByTestId('save-file-button').click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('Rundreise.blurstudio');
  const bytes = readFileSync(await dl.path());

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Öffnen' }).first().click();
  await (
    await chooser
  ).setFiles({ name: 'Rundreise.blurstudio', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByTestId('last-notice')).toContainText('Projekt „Rundreise“ geöffnet');
  const reopened = await page.evaluate(() => window.__bls.getProject());
  expect(reopened?.id).not.toBe(original?.id);
  expect(reopened?.root).toEqual(original?.root);
  expect(reopened?.name).toBe('Rundreise');
});

test('Vorschau 2048 px: ≥ 30 fps beim Regler-Ziehen', async ({ page }, testInfo) => {
  // großes Testbild zur Laufzeit erzeugen (nicht im Repo)
  const W = 2048;
  const H = 1365;
  const img = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      img.data[i] = (x * 255) / W;
      img.data[i + 1] = (y * 255) / H;
      img.data[i + 2] = ((x ^ y) & 64) * 3;
      img.data[i + 3] = 255;
    }
  const path = testInfo.outputPath('big-2048.png');
  writeFileSync(path, PNG.sync.write(img));
  if (await page.getByTestId('project-overview').count()) await page.getByText('Zur Arbeitsfläche').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(path);
  await waitForProject(page);

  const ids = await addEffect(page, 'gaussian-blur', { radius: 20 });
  await addEffect(page, 'black-white', { grain: 30 });
  await addEffect(page, 'color-overlay');
  await settle(page);

  // Direkt gemessen: Rendern + Zeichnen pro geänderter Reglerstellung, inkl. GPU (onSubmittedWorkDone).
  const result = await page.evaluate(async ({ layerId, instanceId }) => {
    const bls = window.__bls;
    const engine = bls.getEngine();
    if (!engine) throw new Error('keine Engine');
    const s = bls.store.getState();
    type Rgb = [number, number, number];
    const dark: Rgb = [0.01, 0.01, 0.01];
    const checkerA: Rgb = [0.1, 0.1, 0.1];
    const checkerB: Rgb = [0.05, 0.05, 0.05];
    const colors = { background: dark, checkerA, checkerB };
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const r = 1 + ((i * 37) % 300);
      bls.commands.setParamCommand(layerId, instanceId, 'radius', r, true);
      const t0 = performance.now();
      engine.present(bls.getProject(), s.view, 2, colors, null);
      await engine.device.queue.onSubmittedWorkDone();
      times.push(performance.now() - t0);
    }
    bls.commands.endGesture();
    times.sort((a, b) => a - b);
    return { median: times[30] ?? 0, p90: times[54] ?? 0, max: times[59] ?? 0 };
  }, ids);
  console.log(
    `Frame 2048 px, 3 Effekte, Radius 1–300: Median ${result.median.toFixed(1)} ms, p90 ${result.p90.toFixed(1)} ms, max ${result.max.toFixed(1)} ms`,
  );
  expect(result.p90).toBeLessThan(33);
});
