// Phase 2: Vordergrund/Hintergrund, Fokus, Schatten, Lizenzmodus, Dienst-Rückfall.
// Modelle kommen aus tests/.cache/models (npm run models:fetch), ausgeliefert vom Dev-Server unter /__models/.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { diffStats, fixture, renderExport, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModels = [
  'birefnet-lite-512-fp16.onnx',
  'rmbg-1.4-fp16.onnx',
  'face_landmarker.task',
  'pose_landmarker_full.task',
].every((f) => existsSync(CACHE + f));

async function setup(context: BrowserContext, settings: { licenseMode?: string; mlMode?: string } = {}) {
  await context.addInitScript((s) => {
    localStorage.setItem('bls.modelMirror', '/__models/');
    localStorage.setItem(
      'bls.settings',
      JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser', ...s }),
    );
  }, settings);
}

async function openPhoto(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(fixture(name));
  await waitForProject(page);
}

/** Wartet auf das Ende einer Aufteilung und liefert die neue Meldung. */
async function waitForSplit(page: Page, before: number): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (n) =>
            window.__bls.store
              .getState()
              .notices.slice(n)
              .find((x) => /Aufgeteilt|fehlgeschlagen/.test(x.text))?.text ?? '',
          before,
        ),
      { timeout: 90_000 },
    )
    .not.toBe('');
  return page.evaluate(
    (n) =>
      window.__bls.store
        .getState()
        .notices.slice(n)
        .find((x) => /Aufgeteilt|fehlgeschlagen/.test(x.text))?.text ?? '',
    before,
  );
}

const noticeCount = (page: Page) => page.evaluate(() => window.__bls.store.getState().notices.length);

/** Varianz des Laplace-Operators (Schärfemaß) in einem Rechteck eines PNG. */
function sharpness(img: PNG, cx: number, cy: number, r: number): number {
  const lum = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return 0.2126 * (img.data[i] ?? 0) + 0.7152 * (img.data[i + 1] ?? 0) + 0.0722 * (img.data[i + 2] ?? 0);
  };
  const vals: number[] = [];
  for (let y = Math.max(1, cy - r); y < Math.min(img.height - 1, cy + r); y++)
    for (let x = Math.max(1, cx - r); x < Math.min(img.width - 1, cx + r); x++)
      vals.push(4 * lum(x, y) - lum(x - 1, y) - lum(x + 1, y) - lum(x, y - 1) - lum(x, y + 1));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
}

test.describe('mit Modellen', () => {
  test.skip(!hasModels, 'Modelle fehlen – zuerst „npm run models:fetch“ ausführen');

  test('Abnahme: Porträt mit scharfen Augen, unscharfem Hintergrund und Schatten in unter 1 Minute', async ({
    page,
    context,
  }) => {
    await setup(context);
    await waitForApp(page);
    await openPhoto(page, 'photo-portrait-street.jpg');
    const t0 = Date.now();

    // 1. Aufteilen (BiRefNet, Fokuspunkte)
    const before = await noticeCount(page);
    await page.getByTestId('split-button').click();
    await expect(page.getByTestId('family-birefnet')).toBeChecked();
    await page.getByTestId('split-start').click();
    const msg = await waitForSplit(page, before);
    expect(msg).toContain('Aufgeteilt mit BiRefNet');
    expect(msg).toMatch(/\d+ Fokuspunkte/);

    // 2. Schatten am Vordergrund (Standard: rechts unten)
    const shadowSection = page.getByTestId('shadow-section');
    await shadowSection.getByRole('button', { name: 'Schatten' }).click();
    await shadowSection.getByRole('switch', { name: 'Schatten-Layer' }).click();
    await expect(page.getByTestId('shadow-params')).toBeVisible();
    const elapsed = Date.now() - t0;
    console.log(`Einstellen per UI: ${(elapsed / 1000).toFixed(1)} s (${msg})`);
    expect(elapsed).toBeLessThan(60_000);

    const state = await page.evaluate(() => {
      const p = window.__bls.getProject();
      const g = p?.root.children[0];
      if (g?.kind !== 'group') return null;
      const fg = g.children[2];
      const bg = g.children[1];
      if (fg?.kind !== 'layer' || bg?.kind !== 'layer') return null;
      return {
        names: g.children.map((c) => c.name),
        fgBlur: fg.effects[0]?.params.radius,
        bgBlur: bg.effects[0]?.params.radius,
        bgHoleFill: bg.holeFill,
        eyes: (fg.focusMap?.points ?? []).filter((x) => x.kind === 'eye').map((x) => [x.x, x.y]),
        shadowDir: fg.shadow?.params.direction,
        commercial: fg.mask.kind === 'stored' && fg.mask.provenance.commercialUse,
      };
    });
    expect(state?.names).toEqual(['photo-portrait-street (Original)', 'Hintergrund', 'Vordergrund']);
    expect(state?.fgBlur).toBe(10);
    expect(state?.bgBlur).toBe(60);
    expect(state?.bgHoleFill).toBe(true);
    expect(state?.eyes).toHaveLength(2);
    expect(state?.shadowDir).toBe(45);
    expect(state?.commercial).toBe(true);

    // 3. Augen scharf, Hintergrund stark unscharf (Schärfemaß im Export)
    const png = await renderExport(page);
    const [eyeX = 0, eyeY = 0] = state?.eyes[0] ?? [];
    const eye = sharpness(png, Math.round(eyeX), Math.round(eyeY), 14);
    const background = sharpness(png, Math.round(png.width * 0.85), Math.round(png.height * 0.25), 40);
    console.log(`Schärfe Auge ${eye.toFixed(1)} · Hintergrund ${background.toFixed(2)}`);
    expect(eye).toBeGreaterThan(background * 20);
  });

  test('Dienst gestoppt → App fällt ohne Fehler auf Browser-Modelle zurück', async ({ page, context }) => {
    await setup(context, { mlMode: 'auto' });
    // Dienst meldet sich zunächst als verfügbar …
    await context.route(/127\.0\.0\.1:8765\/health/, (route) =>
      route.fulfill({
        json: {
          device: 'mps',
          version: 'test',
          models: [{ id: 'birefnet', license: 'MIT', commercialUse: true, loaded: true, available: true }],
        },
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    // … ist aber beim Auftrag nicht mehr erreichbar
    await context.route(/127\.0\.0\.1:8765\/segment/, (route) => route.abort('connectionrefused'));
    await waitForApp(page);
    await expect.poll(() => page.evaluate(() => window.__bls.store.getState().service.state)).toBe('online');
    await openPhoto(page, 'photo-portrait-street.jpg');
    const before = await noticeCount(page);
    await page.getByTestId('split-button').click();
    await page.getByRole('checkbox').uncheck();
    await page.getByTestId('split-start').click();
    const msg = await waitForSplit(page, before);
    expect(msg).toContain('Browser');
    const notices = await page.evaluate((n) => window.__bls.store.getState().notices.slice(n), before);
    expect(notices.some((x) => x.text.includes('Dienst nicht verfügbar') && x.level === 'info')).toBe(true);
    expect(notices.filter((x) => x.level === 'error')).toHaveLength(0);
  });

  test('Lizenzmodus: „Kommerziell“ lädt kein NC-Modell; RMBG-Maske löst die Export-Warnung aus', async ({
    page,
    context,
  }) => {
    await setup(context);
    const modelRequests: string[] = [];
    context.on('request', (r) => {
      if (r.url().includes('/__models/') || /huggingface|googleapis/.test(r.url()))
        modelRequests.push(r.url());
    });
    await waitForApp(page);
    await openPhoto(page, 'photo-portrait-street.jpg');

    // Kommerziell: RMBG gesperrt, nur kommerzielle Modelle werden geladen
    let before = await noticeCount(page);
    await page.getByTestId('split-button').click();
    await expect(page.getByTestId('family-rmbg')).toBeDisabled();
    await page.getByTestId('split-start').click();
    await waitForSplit(page, before);
    expect(modelRequests.some((u) => u.includes('rmbg'))).toBe(false);
    expect(modelRequests.some((u) => u.includes('birefnet'))).toBe(true);
    expect(modelRequests.some((u) => /huggingface|googleapis/.test(u))).toBe(false); // nur lokaler Spiegel

    // Umschalten auf „Alle“: einmaliger Hinweis
    await page.getByTestId('license-pill').click();
    await page.getByTestId('license-all').click();
    await expect(page.getByTestId('license-notice')).toBeVisible();
    await page.getByTestId('license-notice-confirm').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('license-pill')).toHaveText('Alle Modelle (NC)');

    // Original erneut mit RMBG aufteilen
    await page.evaluate(() => {
      const b = window.__bls;
      const g = b.getProject()?.root.children[0];
      if (g?.kind === 'group' && g.children[0]) b.store.getState().select(g.children[0].id);
    });
    before = await noticeCount(page);
    await page.getByTestId('split-button').click();
    await page.getByTestId('family-rmbg').check();
    await page.getByRole('checkbox').uncheck();
    await page.getByTestId('split-start').click();
    expect(await waitForSplit(page, before)).toContain('RMBG');
    expect(modelRequests.some((u) => u.includes('rmbg'))).toBe(true);
    await expect(page.locator('.layer-row .license-badge.nc').first()).toBeVisible();

    // Export warnt und listet die Ebenen
    await page.getByTestId('export-button').click();
    const warning = page.getByTestId('export-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('rmbg-1.4');
    const download = page.waitForEvent('download');
    await page.getByTestId('export-anyway').click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
  });
});

test.describe('mit vorgegebener Maske', () => {
  /** Synthetische Szene: dunkle Scheibe auf hellem Grund, exakte Maske bekannt. */
  function scene(testInfo: { outputPath: (n: string) => string }) {
    const W = 480;
    const H = 320;
    const img = new PNG({ width: W, height: H });
    const mask = new Uint16Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const inside = Math.hypot(x - 240, y - 160) < 90;
        const v = inside ? 25 : 225;
        img.data.set([v, v, v, 255], i * 4);
        mask[i] = inside ? 65535 : 0;
      }
    const path = testInfo.outputPath('scene.png');
    writeFileSync(path, PNG.sync.write(img));
    return { path, mask: Array.from(mask), W, H };
  }

  async function prepare(
    page: Page,
    context: BrowserContext,
    testInfo: { outputPath: (n: string) => string },
  ) {
    await setup(context);
    await waitForApp(page);
    const s = scene(testInfo);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(s.path);
    await waitForProject(page);
    await page.evaluate(
      async ({ mask, W, H }) => {
        const b = window.__bls;
        const layer = b.getProject()?.root.children[0];
        if (!layer) throw new Error('keine Ebene');
        await b.ml.splitWithMask(layer.id, Uint16Array.from(mask), W, H);
      },
      { mask: s.mask, W: s.W, H: s.H },
    );
    return s;
  }

  /** Mittlere Helligkeit (über Schwarz, also inkl. Deckung) im Ring 6…24 px außerhalb der Scheibe. */
  function ringMean(png: PNG): number {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const d = Math.hypot(x - 240, y - 160) - 90;
        if (d >= 6 && d <= 24) {
          const i = (y * png.width + x) * 4;
          sum += ((png.data[i] ?? 0) * (png.data[i + 3] ?? 0)) / 255;
          n++;
        }
      }
    return sum / n;
  }

  test('kein Halo: Lochfüllung hält Vordergrundfarben aus dem unscharfen Hintergrund', async ({
    page,
    context,
  }, testInfo) => {
    await prepare(page, context, testInfo);
    // Vordergrund scharf lassen, nur den Hintergrund stark weichzeichnen
    await page.evaluate(() => {
      const b = window.__bls;
      const g = b.getProject()?.root.children[0];
      if (g?.kind !== 'group') throw new Error('keine Gruppe');
      const fg = g.children[2];
      const bg = g.children[1];
      if (!fg || !bg) throw new Error('Ebenen fehlen');
      for (const fx of fg.effects) b.commands.removeEffectCommand(fg.id, fx.instanceId);
      const blur = bg.effects[0];
      if (blur) b.commands.setParamCommand(bg.id, blur.instanceId, 'radius', 80, false);
    });
    const withFill = ringMean(await renderExport(page));
    // Gegenprobe: ohne Lochfüllung (invertierte Maske) wird der Rand dunkel
    await page.evaluate(() => {
      const b = window.__bls;
      const g = b.getProject()?.root.children[0];
      if (g?.kind === 'group' && g.children[1]) b.commands.setHoleFillCommand(g.children[1].id, false);
    });
    const without = ringMean(await renderExport(page));
    console.log(
      `Ring außerhalb der Kante: mit Lochfüllung ${withFill.toFixed(1)}, ohne ${without.toFixed(1)} (Hintergrund 225)`,
    );
    expect(withFill).toBeGreaterThan(215);
    expect(without).toBeLessThan(withFill - 15);
  });

  test('Kantenversatz und Kantenhärte verändern die Maske; Undo stellt sie wieder her', async ({
    page,
    context,
  }, testInfo) => {
    await prepare(page, context, testInfo);
    const ids = await page.evaluate(() => {
      const g = window.__bls.getProject()?.root.children[0];
      if (g?.kind !== 'group' || !g.children[1] || !g.children[2]) throw new Error('keine Gruppe');
      return { bg: g.children[1].id, fg: g.children[2].id };
    });
    await page.evaluate((id) => {
      window.__bls.commands.setNodeVisibleCommand(id, false);
    }, ids.bg);
    const coverage = async () => {
      const png = await renderExport(page);
      let n = 0;
      for (let i = 3; i < png.data.length; i += 4) if ((png.data[i] ?? 0) > 127) n++;
      return n;
    };
    const base = await coverage();
    await page.evaluate((id) => {
      window.__bls.commands.setMaskEdgeCommand(id, { offset: 15 }, false);
    }, ids.fg);
    const grown = await coverage();
    await page.evaluate((id) => {
      window.__bls.commands.setMaskEdgeCommand(id, { offset: -15 }, false);
    }, ids.fg);
    const shrunk = await coverage();
    console.log(`Deckung: Basis ${base}, +15 px ${grown}, −15 px ${shrunk}`);
    // Kreis r = 90: Fläche ≈ π r²; ±15 px ändern sie deutlich
    expect(grown).toBeGreaterThan(base * 1.25);
    expect(shrunk).toBeLessThan(base * 0.8);

    await page.evaluate((id) => {
      window.__bls.commands.setMaskEdgeCommand(id, { offset: 0, hardness: 100 }, false);
    }, ids.fg);
    const soft = await renderExport(page);
    // sehr weich: am Kreisrand halbtransparent
    const edgeAlpha = soft.data[(160 * soft.width + 240 + 90) * 4 + 3] ?? 0;
    expect(edgeAlpha).toBeGreaterThan(40);
    expect(edgeAlpha).toBeLessThan(215);

    // drei Änderungen an der Kante rückgängig → Ausgangszustand
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+z');
    expect(await coverage()).toBe(base);
  });

  test('Projektdatei mit Maske: sichern und öffnen ergibt dasselbe Bild', async ({
    page,
    context,
  }, testInfo) => {
    await context.addInitScript(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
    await prepare(page, context, testInfo);
    const before = await renderExport(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('save-file-button').click();
    const bytes = readFileSync(await (await download).path());
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Öffnen' }).first().click();
    await (await chooser).setFiles({ name: 'maske.blurstudio', mimeType: 'application/zip', buffer: bytes });
    await expect(page.getByTestId('last-notice')).toContainText('geöffnet');
    const after = await renderExport(page);
    expect(diffStats(before, after).max).toBeLessThanOrEqual(1);
  });
});

test('Vorschau 2048 px mit Fokus-Unschärfe, Linse und Schatten: ≥ 30 fps beim Regler-Ziehen', async ({
  page,
  context,
}, testInfo) => {
  await setup(context);
  await waitForApp(page);
  const W = 2048;
  const H = 1365;
  const img = new PNG({ width: W, height: H });
  const mask = new Uint16Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      img.data.set([(x * 255) / W, (y * 255) / H, ((x ^ y) & 64) * 3, 255], i * 4);
      mask[i] = Math.hypot(x - W / 2, y - H / 2) < 420 ? 65535 : 0;
    }
  const path = testInfo.outputPath('big.png');
  writeFileSync(path, PNG.sync.write(img));
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(path);
  await waitForProject(page);

  const result = await page.evaluate(
    async ({ mask, W, H }) => {
      const b = window.__bls;
      const layer = b.getProject()?.root.children[0];
      if (!layer) throw new Error('keine Ebene');
      await b.ml.splitWithMask(layer.id, Uint16Array.from(mask), W, H);
      const g = b.getProject()?.root.children[0];
      if (g?.kind !== 'group') throw new Error('keine Gruppe');
      const bg = g.children[1];
      const fg = g.children[2];
      if (!bg || !fg) throw new Error('Ebenen fehlen');
      // Vordergrund: Gauß mit Fokuspunkten; Hintergrund: Linse; Schatten
      b.commands.addFocusPointCommand(fg.id, {
        id: 'f1',
        kind: 'eye',
        label: 'A',
        x: 1000,
        y: 650,
        radius: 200,
        enabled: true,
      });
      b.commands.addFocusPointCommand(fg.id, {
        id: 'f2',
        kind: 'face',
        label: 'B',
        x: 1100,
        y: 700,
        radius: 400,
        enabled: true,
      });
      const fgFx = fg.effects[0];
      if (fgFx) b.commands.setParamCommand(fg.id, fgFx.instanceId, 'radius', 40, false);
      const bgFx = bg.effects[0];
      if (bgFx) b.commands.removeEffectCommand(bg.id, bgFx.instanceId);
      const lens = b.commands.addEffectCommand('lens-blur', bg.id);
      if (!lens) throw new Error('Linse fehlt');
      b.commands.setShadowCommand(fg.id, true);
      const engine = b.getEngine();
      if (!engine) throw new Error('keine Engine');
      const s = b.store.getState();
      type Rgb = [number, number, number];
      const c: Rgb = [0.01, 0.01, 0.01];
      const colors = { background: c, checkerA: c, checkerB: c };
      const measure = async (fn: (i: number) => void) => {
        const times: number[] = [];
        for (let i = 0; i < 40; i++) {
          fn(i);
          const t0 = performance.now();
          engine.present(b.getProject(), s.view, 2, colors, null);
          await engine.device.queue.onSubmittedWorkDone();
          times.push(performance.now() - t0);
        }
        b.commands.endGesture();
        times.sort((x, y) => x - y);
        return { median: times[20] ?? 0, p90: times[36] ?? 0 };
      };
      // Regler am Vordergrund (ortsabhängiger Gauß) und an der Linse ziehen
      const gauss = await measure((i) => {
        if (fgFx) b.commands.setParamCommand(fg.id, fgFx.instanceId, 'radius', 5 + ((i * 37) % 200), true);
      });
      const lensT = await measure((i) => {
        b.commands.setParamCommand(bg.id, lens, 'radius', 5 + ((i * 37) % 250), true);
      });
      return { gauss, lens: lensT };
    },
    { mask: Array.from(mask), W, H },
  );
  console.log(
    `2048 px · Gauß mit Fokus: Median ${result.gauss.median.toFixed(1)} ms, p90 ${result.gauss.p90.toFixed(1)} ms · Linse: Median ${result.lens.median.toFixed(1)} ms, p90 ${result.lens.p90.toFixed(1)} ms`,
  );
  expect(result.gauss.p90).toBeLessThan(33);
  expect(result.lens.p90).toBeLessThan(33);
});
