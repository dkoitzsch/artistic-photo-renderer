// E1 Schritt 3: Mischmodus und eigene Maske je Effekt, geprüft gegen CPU-Rechnungen.

import { expect, test, type Page } from '@playwright/test';
import type { PNG } from 'pngjs';
import { diffStats, fixture, openFixture, renderExport, waitForApp } from './helpers';

/** Schwarz-Weiß (voll) auf die erste Ebene; liefert Ebenen- und Effekt-ID. */
async function addBw(page: Page): Promise<{ layerId: string; fxId: string }> {
  return page.evaluate(() => {
    const bls = window.__bls;
    const layer = bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    const fxId = bls.commands.addEffectCommand('black-white', layer.id);
    if (!fxId) throw new Error('Effekt fehlt');
    return { layerId: layer.id, fxId };
  });
}

const px = (img: PNG, i: number) => [
  img.data[i * 4] ?? 0,
  img.data[i * 4 + 1] ?? 0,
  img.data[i * 4 + 2] ?? 0,
];
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, k) => Math.abs(v - (b[k] ?? 0))));

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
  await openFixture(page, 'golden/still-life.png');
});

test('Mischmodus „Multiplizieren“ = Original × Effekt (sRGB-kodiert)', async ({ page }) => {
  const original = await renderExport(page);
  const { layerId, fxId } = await addBw(page);
  const gray = await renderExport(page);
  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setEffectBlendCommand(layerId, fxId, 'multiply');
    },
    { layerId, fxId },
  );
  const got = await renderExport(page);
  let worst = 0;
  for (let i = 0; i < original.width * original.height; i++) {
    const want = px(original, i).map((b, k) => Math.round((b * (px(gray, i)[k] ?? 0)) / 255));
    worst = Math.max(worst, maxDiff(px(got, i), want));
  }
  expect(worst).toBeLessThanOrEqual(2);
  expect(diffStats(got, await renderExport(page, 64)).max).toBe(0);
});

test('Effektmaske aus dem Helligkeitsbereich wirkt nur in den Schatten', async ({ page }) => {
  const original = await renderExport(page);
  const { layerId, fxId } = await addBw(page);
  const gray = await renderExport(page);
  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setEffectMaskCommand(layerId, fxId, {
        kind: 'map',
        map: 'luminance',
        from: 0,
        to: 0.3,
        feather: 0.02,
        invert: false,
      });
    },
    { layerId, fxId },
  );
  const got = await renderExport(page);
  // wahrgenommene Helligkeit der Originalpixel (sRGB-kodierte Luminanz, wie im Shader)
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  let dark = 0;
  let light = 0;
  let worstDark = 0;
  let worstLight = 0;
  for (let i = 0; i < original.width * original.height; i++) {
    const [r, g, b] = px(original, i);
    const y = enc(0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0));
    if (y < 0.26) {
      dark++;
      worstDark = Math.max(worstDark, maxDiff(px(got, i), px(gray, i)));
    } else if (y > 0.34) {
      light++;
      worstLight = Math.max(worstLight, maxDiff(px(got, i), px(original, i)));
    }
  }
  expect(dark).toBeGreaterThan(1000);
  expect(light).toBeGreaterThan(1000);
  expect(worstDark).toBeLessThanOrEqual(1);
  expect(worstLight).toBeLessThanOrEqual(1);
  expect(diffStats(got, await renderExport(page, 64)).max).toBe(0);

  // umgekehrt: nur die hellen Bereiche
  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setEffectMaskCommand(layerId, fxId, {
        kind: 'map',
        map: 'luminance',
        from: 0,
        to: 0.3,
        feather: 0.02,
        invert: true,
      });
    },
    { layerId, fxId },
  );
  const inverted = await renderExport(page);
  let worst = 0;
  for (let i = 0; i < original.width * original.height; i++) {
    const [r, g, b] = px(original, i);
    const y = enc(0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0));
    if (y > 0.34) worst = Math.max(worst, maxDiff(px(inverted, i), px(gray, i)));
  }
  expect(worst).toBeLessThanOrEqual(1);
});

test('Effektmaske aus einer anderen Ebene folgt deren Lage; Undo entfernt sie', async ({ page }) => {
  const original = await renderExport(page);
  const { layerId, fxId } = await addBw(page);
  const gray = await renderExport(page);
  // Zweite Ebene (kleines Bild, eingepasst) – unsichtbar, dient nur als Maske
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  await (await chooser).setFiles(fixture('sharp-256x192.png'));
  await expect.poll(() => page.evaluate(() => window.__bls.getProject()?.root.children.length)).toBe(2);
  const maskLayer = await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[1];
    if (!l) throw new Error('Ebene fehlt');
    // 1:1 und mittig: Rechteck 256 × 192 auf 384 × 256 → x 64..319, y 32..223
    window.__bls.commands.setTransformCommand(l.id, { x: 0, y: 0, scale: 1, rotation: 0 }, false);
    window.__bls.commands.setNodeVisibleCommand(l.id, false);
    return l.id;
  });
  await page.evaluate(
    ({ layerId, fxId, maskLayer }) => {
      window.__bls.commands.setEffectMaskCommand(layerId, fxId, {
        kind: 'layer',
        layerId: maskLayer,
        invert: false,
      });
    },
    { layerId, fxId, maskLayer },
  );
  const check = (img: PNG, x0: number, y0: number) => {
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = y * img.width + x;
        const isIn = x >= x0 && x < x0 + 256 && y >= y0 && y < y0 + 192;
        if (isIn) inside = Math.max(inside, maxDiff(px(img, i), px(gray, i)));
        else outside = Math.max(outside, maxDiff(px(img, i), px(original, i)));
      }
    return { inside, outside };
  };
  expect(check(await renderExport(page), 64, 32)).toEqual({ inside: 0, outside: 0 });
  // Maskenebene verschieben → Maske wandert mit
  await page.evaluate((id) => {
    window.__bls.commands.setTransformCommand(id, { x: -40, y: 10 }, false);
  }, maskLayer);
  const moved = await renderExport(page);
  expect(check(moved, 24, 42)).toEqual({ inside: 0, outside: 0 });
  expect(diffStats(moved, await renderExport(page, 64)).max).toBe(0);
  // Undo (Verschieben, Maske) → wieder ohne Maske
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  expect(diffStats(await renderExport(page), gray).max).toBe(0);
});

test('Effektmaske und Mischmodus in der Oberfläche', async ({ page }) => {
  await addBw(page);
  const card = page.getByTestId('effect-card-black-white');
  await card.getByLabel('Mischmodus').selectOption('screen');
  await card.getByTestId('effect-mask-select').selectOption('map:luminance');
  await expect(card.getByTestId('effect-mask-to')).toBeVisible();
  const fx = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.effects[0]);
  expect(fx?.blendMode).toBe('screen');
  expect(fx?.mask).toMatchObject({ kind: 'map', map: 'luminance', from: 0, to: 0.3 });
});
