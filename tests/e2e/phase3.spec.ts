// Phase 3: Tiefenebenen, Gruppenmodus mit Entkoppeln, Ebenenliste, Parallax, PSD-Export.
// Das Tiefenmodell kommt aus tests/.cache/models (npm run models:fetch), ausgeliefert unter /__models/.

import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readPsd, type Layer as PsdLayer } from 'ag-psd';
import { PNG } from 'pngjs';
import { diffStats, fixture, openFixture, settle, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasDepthModel = existsSync(CACHE + 'depth-anything-v2-small-fp16.onnx');

async function setup(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('bls.modelMirror', '/__models/');
    localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
  });
}

async function openPhoto(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(fixture(name));
  await waitForProject(page);
}

/** Struktur des Projekts: Namen und Effektparameter je Ebene einer Gruppe. */
function groupLayers(page: Page, groupName: string) {
  return page.evaluate((name) => {
    const project = window.__bls.getProject();
    const group = project?.root.children.find((c) => c.kind === 'group' && c.name === name);
    if (group?.kind !== 'group') return null;
    return group.children.map((c) => ({
      id: c.id,
      name: c.name,
      visible: c.visible,
      kind: c.kind,
      blur: c.effects.find((e) => e.effectId === 'gaussian-blur')?.params.radius as number | undefined,
      haze: c.effects.find((e) => e.effectId === 'haze')?.params.amount as number | undefined,
      mask: c.kind === 'layer' ? c.mask.kind : null,
    }));
  }, groupName);
}

async function canvasShot(page: Page): Promise<PNG> {
  await settle(page);
  return PNG.sync.read(await page.getByTestId('canvas').screenshot());
}

/** Splits the landscape into 4 depth layers through the dialog (as a user would). */
async function splitLandscape(page: Page) {
  await openPhoto(page, 'photo-landscape-lake.jpg');
  await page.locator('[data-testid="layer-row-layer"]').first().click();
  await page.getByTestId('split-button').click();
  await page.getByTestId('mode-depth').check();
  await page.getByTestId('depth-compute').click();
  await expect(page.getByTestId('band-preview')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('depth-histogram').locator('.histogram-handle')).toHaveCount(3);
  await page.getByTestId('depth-start').click();
  await expect.poll(() => groupLayers(page, 'Tiefenebenen').then((g) => g?.length ?? 0)).toBe(5);
}

test.describe('Tiefenebenen (mit Modell)', () => {
  test.skip(!hasDepthModel, 'Tiefenmodell fehlt – npm run models:fetch');
  test.setTimeout(180_000);

  test.beforeEach(async ({ context, page }) => {
    await setup(context);
    await waitForApp(page);
  });

  test('Abnahme: Landschaft in 4 Ebenen, Gruppen-Blur wirkt auf alle, entkoppelte Ebene behält Wert', async ({
    page,
  }) => {
    await splitLandscape(page);
    const layers = (await groupLayers(page, 'Tiefenebenen')) ?? [];
    // Kind 0 = verborgenes Original, dann fern → nah
    expect(layers[0]?.visible).toBe(false);
    const bands = layers.slice(1);
    expect(bands.map((l) => l.mask)).toEqual(['depth', 'depth', 'depth', 'depth']);
    expect(bands.map((l) => l.name)).toEqual(['Ebene 4 (fern)', 'Ebene 3', 'Ebene 2', 'Ebene 1 (nah)']);
    // Preset: Unschärfe und Dunst nehmen mit der Entfernung zu
    const blurs = bands.map((l) => l.blur ?? -1);
    expect(blurs[3]).toBe(0);
    for (let i = 0; i < 3; i++) expect(blurs[i] ?? 0).toBeGreaterThan(blurs[i + 1] ?? 0);
    const hazes = bands.map((l) => l.haze ?? -1);
    for (let i = 0; i < 3; i++) expect(hazes[i] ?? 0).toBeGreaterThan(hazes[i + 1] ?? 0);

    // Gruppenmodus einschalten
    await page.locator('[data-testid="layer-row-group"][data-name="Tiefenebenen"]').click();
    await page.getByTestId('group-edit').getByRole('radio', { name: 'Gruppe' }).click();
    await expect(page.locator('.group-mode-badge')).toBeVisible();

    // „Ebene 3“ entkoppelt ihren Radius
    const decoupled = bands[1];
    if (!decoupled) throw new Error('Ebene 3 fehlt');
    await page.locator(`[data-testid="layer-row-layer"][data-id="${decoupled.id}"]`).click();
    await page.getByTestId('effect-card-gaussian-blur').getByTestId('lock-radius').click();

    // Gruppen-Blur auf 80 px
    await page.locator('[data-testid="layer-row-group"][data-name="Tiefenebenen"]').click();
    const input = page
      .getByTestId('shared-gaussian-blur')
      .getByTestId('param-radius')
      .locator('.slider-input');
    await input.fill('80');
    await input.press('Enter');

    const after = ((await groupLayers(page, 'Tiefenebenen')) ?? []).slice(1);
    for (const l of after) {
      if (l.id === decoupled.id) expect(l.blur).toBe(decoupled.blur);
      else expect(l.blur).toBe(80);
    }
    // Dunst bleibt unberührt
    expect(after.map((l) => l.haze)).toEqual(hazes);

    // Rückgängig nimmt die Gruppenänderung als einen Schritt zurück
    await page.keyboard.press('Meta+z');
    const undone = ((await groupLayers(page, 'Tiefenebenen')) ?? []).slice(1);
    expect(undone.map((l) => l.blur)).toEqual(blurs);
  });

  test('Tiefenansicht und Parallax-Vorschau', async ({ page }) => {
    await splitLandscape(page);
    const result = await canvasShot(page);

    await page.getByTestId('view-depth').click();
    const depthView = await canvasShot(page);
    expect(diffStats(result, depthView).mean).toBeGreaterThan(10);
    await page.getByTestId('view-result').click();

    // Parallax verschiebt die Ebenen je nach Tiefe → Bild ändert sich, Projekt nicht
    const before = await page.evaluate(() => JSON.stringify(window.__bls.getProject()));
    await page.getByTestId('parallax-toggle').click();
    await expect(page.getByTestId('parallax-panel')).toBeVisible();
    await page.evaluate(() => {
      window.__bls.store.getState().setParallax({ strength: 100, pointer: [1, 0] });
    });
    const shifted = await canvasShot(page);
    expect(diffStats(result, shifted).mean).toBeGreaterThan(0.5);
    expect(await page.evaluate(() => JSON.stringify(window.__bls.getProject()))).toBe(before);
    await page.evaluate(() => {
      window.__bls.store.getState().setParallax({ pointer: [0, 0] });
    });
    // Zeiger in der Mitte = kein Versatz (das Panel liegt im Bildschirmfoto, daher Mittelwert)
    const centered = await canvasShot(page);
    expect(diffStats(result, centered).mean).toBeLessThan(diffStats(result, shifted).mean / 4);
    await page.getByTestId('parallax-panel').getByRole('button', { name: 'Beenden' }).click();
    await expect(page.getByTestId('parallax-panel')).toBeHidden();
    expect(diffStats(result, await canvasShot(page)).max).toBeLessThanOrEqual(2);
  });

  test('Abnahme: PSD mit Ebenen- und Gruppenstruktur', async ({ page }, testInfo) => {
    await splitLandscape(page);
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-psd').check();
    await page.getByTestId('export-originals').check();
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-start').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.psd$/);
    // Kopie zur Prüfung mit anderen Programmen (z. B. psd-tools)
    await file.saveAs(testInfo.outputPath('export.psd'));
    const psd = readPsd(readFileSync(await file.path()), {
      skipCompositeImageData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
      useImageData: true,
    });
    const project = await page.evaluate(() => window.__bls.getProject()?.canvas);
    expect([psd.width, psd.height]).toEqual([project?.width, project?.height]);
    const top = psd.children ?? [];
    expect(top.map((l) => l.name)).toEqual(['Originale', 'Tiefenebenen']);
    expect(top[0]?.hidden).toBe(true);
    const group = top[1] as PsdLayer;
    const originalName = await page.evaluate(() => {
      const g = window.__bls.getProject()?.root.children[0];
      return g?.kind === 'group' ? g.children[0]?.name : null;
    });
    expect(group.children?.map((l) => l.name)).toEqual([
      originalName,
      'Ebene 4 (fern)',
      'Ebene 3',
      'Ebene 2',
      'Ebene 1 (nah)',
    ]);
    expect(group.children?.[0]?.hidden).toBe(true);
    // Masken der Tiefenebenen liegen als (deaktivierte) Ebenenmasken bei
    for (const l of group.children?.slice(1) ?? []) {
      expect(l.mask?.disabled).toBe(true);
      expect(l.blendMode).toBe('normal');
    }
  });
});

test.describe('Ebenenliste und Gruppen (ohne Modell)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await openFixture(page);
  });

  test('Gruppieren, verschachteln, Ziehen, Auflösen', async ({ page }) => {
    const tree = () =>
      page.evaluate(() => {
        type N = { name: string; kind: string; children?: N[] };
        const sum = (n: N): unknown => (n.kind === 'group' ? { [n.name]: (n.children ?? []).map(sum) } : 'L');
        const p = window.__bls.getProject();
        return p ? (p.root.children as N[]).map(sum) : null;
      });
    await page.getByTestId('layer-row-layer').first().click();
    await page.getByTestId('group-button').click();
    await expect.poll(tree).toEqual([{ Gruppe: ['L'] }]);
    // Gruppe erneut gruppieren → verschachtelt; Auflösen der äußeren stellt den Zustand wieder her
    await page.getByTestId('group-button').click();
    await expect.poll(tree).toEqual([{ Gruppe: [{ Gruppe: ['L'] }] }]);
    await page.locator('[data-testid="layer-row-group"][data-name="Gruppe"]').first().click();
    await page.getByTestId('ungroup-button').click();
    await expect.poll(tree).toEqual([{ Gruppe: ['L'] }]);

    // Ebene aus der Gruppe über die Gruppe ziehen (oberer Rand = darüber)
    const groupRow = page.locator('[data-testid="layer-row-group"][data-name="Gruppe"]');
    const box = await groupRow.boundingBox();
    if (!box) throw new Error('Gruppenzeile unsichtbar');
    await page
      .getByTestId('layer-row-layer')
      .first()
      .dragTo(groupRow, { targetPosition: { x: box.width / 2, y: 2 } });
    await expect.poll(tree).toEqual([{ Gruppe: [] }, 'L']);
    // und wieder hinein (Mitte der Gruppenzeile)
    await page.getByTestId('layer-row-layer').first().dragTo(groupRow);
    await expect.poll(tree).toEqual([{ Gruppe: ['L'] }]);

    await groupRow.click();
    await page.getByTestId('ungroup-button').click();
    await expect.poll(tree).toEqual(['L']);
  });

  test('Export-Dialog: JPEG und WebP', async ({ page }) => {
    for (const [format, ext] of [
      ['jpeg', 'jpg'],
      ['webp', 'webp'],
    ] as const) {
      await page.getByTestId('export-button').click();
      await page.getByTestId(`export-${format}`).check();
      const download = page.waitForEvent('download');
      await page.getByTestId('export-start').click();
      expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
    }
  });
});

test('Tiefe über den Dienst: Rückfall auf das Browser-Modell', async ({ context, page }) => {
  test.skip(!hasDepthModel, 'Tiefenmodell fehlt – npm run models:fetch');
  test.setTimeout(120_000);
  await context.addInitScript(() => {
    localStorage.setItem('bls.modelMirror', '/__models/');
    localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'auto' }));
  });
  // Dienst „online“, aber /depth schlägt fehl
  await context.route('http://127.0.0.1:8765/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/health'))
      return route.fulfill({
        json: {
          device: 'mps',
          version: 'test',
          models: [
            {
              id: 'depth-anything-v2-small-hr',
              license: 'Apache-2.0',
              commercialUse: true,
              loaded: false,
              available: true,
            },
          ],
        },
      });
    return route.fulfill({ status: 500, body: 'kaputt' });
  });
  await waitForApp(page);
  await openPhoto(page, 'photo-landscape-lake.jpg');
  await page.locator('[data-testid="layer-row-layer"]').first().click();
  await page.getByTestId('split-button').click();
  await page.getByTestId('mode-depth').check();
  await page.getByTestId('depth-compute').click();
  await expect(page.getByTestId('band-preview')).toBeVisible({ timeout: 90_000 });
  const notices = await page.evaluate(() => window.__bls.store.getState().notices.map((n) => n.text));
  expect(notices.some((t) => t.includes('Browser-Modell wird verwendet'))).toBe(true);
});
