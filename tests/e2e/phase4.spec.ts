// Phase 4: weitere Bilder als Ebenen, Transform, Reihenfolge. CPU-Referenzen für die Platzierung (Warp).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { diffStats, fixture, openFixture, renderExport, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModels = ['birefnet-lite-512-fp16.onnx', 'depth-anything-v2-small-fp16.onnx'].every((f) =>
  existsSync(CACHE + f),
);

async function addImage(page: Page, name: string): Promise<string> {
  const before = await layerIds(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  await (await chooser).setFiles(fixture(name));
  await expect.poll(async () => (await layerIds(page)).length).toBe(before.length + 1);
  const after = await layerIds(page);
  const id = after.find((x) => !before.includes(x));
  if (!id) throw new Error('neue Ebene fehlt');
  return id;
}

function layerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const p = window.__bls.getProject();
    const out: string[] = [];
    const visit = (n: { kind: string; id: string; children?: unknown[] }) => {
      if (n.kind === 'layer') out.push(n.id);
      for (const c of (n.children ?? []) as (typeof n)[]) visit(c);
    };
    if (p) visit(p.root);
    return out;
  });
}

/** Baum als Namen (Gruppen als { Name: [...] }) */
function tree(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    type N = { name: string; kind: string; children?: N[] };
    const sum = (n: N): unknown => (n.kind === 'group' ? { [n.name]: (n.children ?? []).map(sum) } : n.name);
    const p = window.__bls.getProject();
    return p ? sum(p.root) : null;
  });
}

async function setTransform(page: Page, id: string, t: Record<string, number | boolean>): Promise<void> {
  await page.evaluate(
    ({ id, t }) => {
      window.__bls.commands.setTransformCommand(id, t, false);
    },
    { id, t },
  );
}

async function hideFirstLayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const first = window.__bls.getProject()?.root.children[0];
    if (first) window.__bls.commands.setNodeVisibleCommand(first.id, false);
  });
}

/** Vergleicht das Export-PNG mit einer CPU-Referenz (gerades Alpha); Farbe nur bei Alpha > 0. */
function compare(got: PNG, want: (x: number, y: number) => [number, number, number, number]) {
  let maxColor = 0;
  let maxAlpha = 0;
  for (let y = 0; y < got.height; y++)
    for (let x = 0; x < got.width; x++) {
      const i = (y * got.width + x) * 4;
      const w = want(x, y);
      maxAlpha = Math.max(maxAlpha, Math.abs((got.data[i + 3] ?? 0) - w[3]));
      if (w[3] < 255 || (got.data[i + 3] ?? 0) < 255) continue;
      for (let c = 0; c < 3; c++)
        maxColor = Math.max(maxColor, Math.abs((got.data[i + c] ?? 0) - (w[c] ?? 0)));
    }
  return { maxColor, maxAlpha };
}

test.describe('Platzierung (Warp) gegen CPU-Referenz', () => {
  const sharp = PNG.sync.read(readFileSync(fixture('sharp-256x192.png')));
  const px = (x: number, y: number): [number, number, number, number] => {
    if (x < 0 || y < 0 || x >= sharp.width || y >= sharp.height) return [0, 0, 0, 0];
    const i = (y * sharp.width + x) * 4;
    return [sharp.data[i] ?? 0, sharp.data[i + 1] ?? 0, sharp.data[i + 2] ?? 0, sharp.data[i + 3] ?? 0];
  };
  let layerId = '';

  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await openFixture(page);
    layerId = await addImage(page, 'sharp-256x192.png');
    await hideFirstLayer(page);
  });

  test('Verschieben, 90° drehen und Spiegeln sind pixelgenau', async ({ page }) => {
    // Neutral: kleineres Bild zentriert (400×300 Leinwand)
    await setTransform(page, layerId, { x: 0, y: 0, scale: 1, rotation: 0 });
    let r = compare(await renderExport(page), (x, y) => px(x - 72, y - 54));
    expect(r).toEqual({ maxColor: 0, maxAlpha: 0 });

    await setTransform(page, layerId, { x: 37, y: -21 });
    r = compare(await renderExport(page), (x, y) => px(x - 72 - 37, y - 54 + 21));
    expect(r).toEqual({ maxColor: 0, maxAlpha: 0 });

    // 90° im Uhrzeigersinn: Leinwand (X, Y) ← Bild (Y − 22, 295 − X)
    await setTransform(page, layerId, { x: 0, y: 0, rotation: 90 });
    r = compare(await renderExport(page), (x, y) => px(y - 22, 295 - x));
    expect(r.maxColor).toBeLessThanOrEqual(1);
    expect(r.maxAlpha).toBeLessThanOrEqual(1);

    await setTransform(page, layerId, { rotation: 0, flipX: true });
    r = compare(await renderExport(page), (x, y) => px(255 - (x - 72), y - 54));
    expect(r).toEqual({ maxColor: 0, maxAlpha: 0 });
  });

  test('Halbe Größe entspricht dem Flächenmittel (2 × 2)', async ({ page }) => {
    await setTransform(page, layerId, { scale: 0.5 });
    const got = await renderExport(page);
    // 128 × 96 zentriert: Ursprung (136, 102); Referenz in linearem Licht gemittelt
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const srgb = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
    const r = compare(got, (x, y) => {
      const sx = (x - 136) * 2;
      const sy = (y - 102) * 2;
      if (sx < 0 || sy < 0 || sx >= 256 || sy >= 192) return [0, 0, 0, 0];
      const taps = [px(sx, sy), px(sx + 1, sy), px(sx, sy + 1), px(sx + 1, sy + 1)];
      const a = taps.reduce((s, t) => s + t[3], 0) / 4;
      const c = [0, 1, 2].map((k) =>
        srgb(taps.reduce((s, t) => s + lin(t[k] ?? 0) * t[3], 0) / 4 / Math.max(a, 1e-6)),
      );
      return [Math.round(c[0] ?? 0), Math.round(c[1] ?? 0), Math.round(c[2] ?? 0), Math.round(a)];
    });
    expect(r.maxColor).toBeLessThanOrEqual(2);
    expect(r.maxAlpha).toBeLessThanOrEqual(1);
  });

  test('gedrehte Ebene mit Unschärfe: Kachel-Export nahtlos, Vorschau zeigt sie', async ({ page }) => {
    await setTransform(page, layerId, { rotation: 30, scale: 1.3, x: 20, y: 10 });
    await page.evaluate((id) => {
      const fx = window.__bls.commands.addEffectCommand('gaussian-blur', id);
      if (fx) window.__bls.commands.setParamCommand(id, fx, 'radius', 12, false);
    }, layerId);
    const whole = await renderExport(page);
    const tiled = await renderExport(page, 96);
    expect(diffStats(whole, tiled).max).toBe(0);
    // Ecke (außerhalb) transparent, Mitte deckend
    expect(whole.data[3]).toBe(0);
    expect(whole.data[(150 * 400 + 200) * 4 + 3]).toBe(255);
  });
});

test.describe('Ebenen hinzufügen, transformieren, ordnen (UI)', () => {
  test.beforeEach(async ({ page }) => {
    // Sichern als Download statt Dateidialog
    await page.addInitScript(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
    await waitForApp(page);
    await openFixture(page);
  });

  test('Bild als Ebene: über der Auswahl, Füllen/Einpassen, Rahmen ziehen, Reihenfolge per Tasten, Löschen', async ({
    page,
  }) => {
    const id = await addImage(page, 'photo-landscape-lake.jpg');
    // JPEG (deckend) füllt die Leinwand: 1600×900 → 400×300 braucht Skalierung 1/3
    const t = () =>
      page.evaluate((lid) => {
        const p = window.__bls.getProject();
        const visit = (n: { id: string; children?: unknown[]; transform?: unknown }): unknown => {
          if (n.id === lid) return n.transform;
          for (const c of (n.children ?? []) as (typeof n)[]) {
            const r = visit(c);
            if (r) return r;
          }
          return null;
        };
        return p ? (visit(p.root) as { x: number; y: number; scale: number; rotation: number }) : null;
      }, id);
    expect((await t())?.scale).toBeCloseTo(1 / 3, 5);
    expect(await tree(page)).toEqual({ Bild: ['synthetic-400x300', 'photo-landscape-lake'] });

    await expect(page.getByTestId('transform-section')).toBeVisible();
    await page.getByTestId('transform-fit').click();
    expect((await t())?.scale).toBeCloseTo(0.25, 5);
    await page.getByTestId('transform-fill').click();
    expect((await t())?.scale).toBeCloseTo(1 / 3, 5);

    // Rahmen ziehen verschiebt (Werkzeug „Verschieben“), eine Geste = ein Undo-Schritt
    const body = page.getByTestId('transform-body');
    const box = await page.getByTestId('canvas').boundingBox();
    if (!box) throw new Error('keine Leinwand');
    const zoom = await page.evaluate(() => window.__bls.store.getState().view.zoom);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy + 10, { steps: 5 });
    await page.mouse.move(cx + 40, cy + 20, { steps: 5 });
    await page.mouse.up();
    await expect(body).toBeVisible();
    const moved = await t();
    expect(moved?.x).toBeCloseTo(40 / zoom, 0);
    expect(moved?.y).toBeCloseTo(20 / zoom, 0);
    await page.keyboard.press('Meta+z');
    expect((await t())?.x).toBeCloseTo(0, 5);

    // Pfeiltaste: 10 px mit ⇧
    await page.keyboard.press('Shift+ArrowLeft');
    expect((await t())?.x).toBeCloseTo(-10, 5);

    // Drehen per Griff um 90° (Mitte → rechts von der Mitte)
    const rot = page.getByTestId('transform-rotate');
    const rb = await rot.boundingBox();
    if (!rb) throw new Error('Drehgriff fehlt');
    const centerX = cx - 10 * zoom;
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(centerX + 150, cy + 1, { steps: 8 });
    await page.keyboard.down('Shift');
    await page.mouse.move(centerX + 160, cy, { steps: 2 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect((await t())?.rotation).toBe(90);

    // Reihenfolge: ⌘[ nach hinten, ⌘] nach vorn
    await page.keyboard.press('Meta+BracketLeft');
    expect(await tree(page)).toEqual({ Bild: ['photo-landscape-lake', 'synthetic-400x300'] });
    await page.keyboard.press('Meta+BracketRight');
    expect(await tree(page)).toEqual({ Bild: ['synthetic-400x300', 'photo-landscape-lake'] });
    await page.getByTestId('layer-back').click();
    expect(await tree(page)).toEqual({ Bild: ['photo-landscape-lake', 'synthetic-400x300'] });

    // Löschen und Rückgängig
    await page.getByTestId('delete-node').click();
    expect(await tree(page)).toEqual({ Bild: ['synthetic-400x300'] });
    await page.keyboard.press('Meta+z');
    expect(await tree(page)).toEqual({ Bild: ['photo-landscape-lake', 'synthetic-400x300'] });
  });

  test('Bild auf die Leinwand ziehen fügt eine Ebene hinzu; Projekt übersteht Sichern und Öffnen', async ({
    page,
  }) => {
    const bytes = readFileSync(fixture('sharp-256x192.png')).toString('base64');
    const dt = await page.evaluateHandle((b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const d = new DataTransfer();
      d.items.add(new File([arr], 'sharp-256x192.png', { type: 'image/png' }));
      return d;
    }, bytes);
    await page.locator('.canvas-area').dispatchEvent('drop', { dataTransfer: dt });
    await expect.poll(() => tree(page)).toEqual({ Bild: ['synthetic-400x300', 'sharp-256x192'] });
    const id = (await layerIds(page))[1] ?? '';
    await setTransform(page, id, { rotation: 45, x: -30, flipY: true });
    const before = await renderExport(page);

    // Projektdatei sichern und wieder öffnen → gleiches Bild
    const download = page.waitForEvent('download');
    await page.getByTestId('save-file-button').click();
    const dl = await download;
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Meta+o');
    await (
      await chooser
    ).setFiles({
      name: dl.suggestedFilename(),
      mimeType: 'application/zip',
      buffer: readFileSync(await dl.path()),
    });
    await waitForProject(page);
    await expect.poll(() => tree(page)).toEqual({ Bild: ['synthetic-400x300', 'sharp-256x192'] });
    expect(diffStats(before, await renderExport(page)).max).toBe(0);
  });
});

test.describe('Abnahme (mit Modellen)', () => {
  test.skip(!hasModels, 'Modelle fehlen – npm run models:fetch');
  test.setTimeout(240_000);

  async function setup(context: BrowserContext) {
    await context.addInitScript(() => {
      localStorage.setItem('bls.modelMirror', '/__models/');
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    });
  }

  test('freigestellte Person vor neuer Landschaft; Person schrittweise zwischen die Tiefenebenen', async ({
    context,
    page,
  }, testInfo) => {
    await setup(context);
    await waitForApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(fixture('photo-portrait-street.jpg'));
    await waitForProject(page);

    // 1. Person freistellen (Vordergrund/Hintergrund)
    await page.getByTestId('layer-row-layer').first().click();
    await page.getByTestId('split-button').click();
    await page.getByTestId('family-birefnet').check();
    await page.getByTestId('split-start').click();
    await expect
      .poll(() => tree(page), { timeout: 90_000 })
      .toEqual({ Bild: [{ Motiv: ['photo-portrait-street (Original)', 'Hintergrund', 'Vordergrund'] }] });
    const ids = await page.evaluate(() => {
      const g = window.__bls.getProject()?.root.children[0];
      return g?.kind === 'group' ? g.children.map((c) => c.id) : [];
    });
    const [, bgId, fgId] = ids;
    if (!bgId || !fgId) throw new Error('Aufteilung fehlt');
    const mask = await page.evaluate(async (id) => {
      const engine = window.__bls.getEngine();
      const p = window.__bls.getProject();
      if (!engine || !p) return null;
      return Array.from((await engine.layerMask(p, id)) ?? []);
    }, fgId);
    if (!mask) throw new Error('Maske fehlt');
    const withPortraitBg = await renderExport(page);

    // 2. Landschaft als neue Ebene über dem alten Hintergrund (= hinter der Person)
    await page.locator(`[data-testid="layer-row-layer"][data-id="${bgId}"]`).click();
    const landscapeId = await addImage(page, 'photo-landscape-lake.jpg');
    expect(await tree(page)).toEqual({
      Bild: [
        {
          Motiv: ['photo-portrait-street (Original)', 'Hintergrund', 'photo-landscape-lake', 'Vordergrund'],
        },
      ],
    });
    const withLandscape = await renderExport(page);
    writeFileSync(testInfo.outputPath('1-landschaft.png'), PNG.sync.write(withLandscape));
    // Person unverändert, Hintergrund ausgetauscht
    const region = (img: PNG, ref: PNG, pick: (m: number) => boolean) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!pick(mask[i] ?? 0)) continue;
        for (let c = 0; c < 3; c++) sum += Math.abs((img.data[i * 4 + c] ?? 0) - (ref.data[i * 4 + c] ?? 0));
        n += 3;
      }
      return sum / Math.max(1, n);
    };
    expect(region(withLandscape, withPortraitBg, (m) => m > 250)).toBeLessThan(1);
    expect(region(withLandscape, withPortraitBg, (m) => m < 5)).toBeGreaterThan(20);

    // 3. Landschaft in 4 Tiefenebenen zerlegen
    await page.locator(`[data-testid="layer-row-layer"][data-id="${landscapeId}"]`).click();
    await page.getByTestId('split-button').click();
    await page.getByTestId('mode-depth').check();
    await page.getByTestId('depth-compute').click();
    await expect(page.getByTestId('band-preview')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('depth-start').click();
    const bands = [
      'photo-landscape-lake (Original)',
      'Ebene 4 (fern)',
      'Ebene 3',
      'Ebene 2',
      'Ebene 1 (nah)',
    ];
    await expect
      .poll(() => tree(page))
      .toEqual({
        Bild: [
          {
            Motiv: [
              'photo-portrait-street (Original)',
              'Hintergrund',
              { Tiefenebenen: bands },
              'Vordergrund',
            ],
          },
        ],
      });

    // 4. Person schrittweise nach hinten: jeweils hinter die nächste Tiefenebene
    await page.locator(`[data-testid="layer-row-layer"][data-id="${fgId}"]`).click();
    const expected = [
      [
        'photo-landscape-lake (Original)',
        'Ebene 4 (fern)',
        'Ebene 3',
        'Ebene 2',
        'Vordergrund',
        'Ebene 1 (nah)',
      ],
      [
        'photo-landscape-lake (Original)',
        'Ebene 4 (fern)',
        'Ebene 3',
        'Vordergrund',
        'Ebene 2',
        'Ebene 1 (nah)',
      ],
      [
        'photo-landscape-lake (Original)',
        'Ebene 4 (fern)',
        'Vordergrund',
        'Ebene 3',
        'Ebene 2',
        'Ebene 1 (nah)',
      ],
      [
        'photo-landscape-lake (Original)',
        'Vordergrund',
        'Ebene 4 (fern)',
        'Ebene 3',
        'Ebene 2',
        'Ebene 1 (nah)',
      ],
    ];
    const personArea: number[] = [];
    for (const order of expected) {
      await page.keyboard.press('Meta+BracketLeft');
      expect(await tree(page)).toEqual({
        Bild: [{ Motiv: ['photo-portrait-street (Original)', 'Hintergrund', { Tiefenebenen: order }] }],
      });
      const step = await renderExport(page);
      writeFileSync(testInfo.outputPath(`2-schritt-${personArea.length + 1}.png`), PNG.sync.write(step));
      personArea.push(region(step, withLandscape, (m) => m > 250));
    }
    // je weiter hinten, desto mehr wird die Person verdeckt; hinter der fernsten (deckenden) Ebene ganz
    for (let i = 1; i < personArea.length; i++)
      expect(personArea[i] ?? 0).toBeGreaterThanOrEqual((personArea[i - 1] ?? 0) - 0.5);
    await page.evaluate((id) => {
      window.__bls.commands.setNodeVisibleCommand(id, false);
    }, fgId);
    const withoutPerson = await renderExport(page);
    await page.keyboard.press('Meta+z');
    expect(diffStats(await renderExport(page), withoutPerson).max).toBeLessThanOrEqual(1);
    console.log(
      `Abweichung im Personenbereich je Schritt: ${personArea.map((v) => v.toFixed(1)).join(' → ')}`,
    );

    // und wieder nach vorn (⌘] viermal) bis vor die nächste Ebene
    for (let i = 0; i < 4; i++) await page.keyboard.press('Meta+BracketRight');
    expect(await tree(page)).toEqual({
      Bild: [
        {
          Motiv: [
            'photo-portrait-street (Original)',
            'Hintergrund',
            { Tiefenebenen: [...bands, 'Vordergrund'] },
          ],
        },
      ],
    });
  });
});
