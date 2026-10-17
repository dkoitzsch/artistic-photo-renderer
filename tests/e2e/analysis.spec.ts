// E1 Schritt 6: Analysekarten luminance und edges – CPU-Referenz, Richtung, Effekt-Eingang (Ebene und Gruppe),
// Kacheln, Ansicht „Karten“.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  canvasPixel,
  diffStats,
  fixture,
  openFixture,
  renderExport,
  waitForApp,
  enableTestEffects,
} from './helpers';

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/** CPU-Referenz: wahrgenommene Helligkeit je Pixel (deckendes Bild). */
function luminance(img: PNG): Float64Array {
  const out = new Float64Array(img.width * img.height);
  for (let i = 0; i < out.length; i++)
    out[i] = enc(
      0.2126 * lin(img.data[i * 4] ?? 0) +
        0.7152 * lin(img.data[i * 4 + 1] ?? 0) +
        0.0722 * lin(img.data[i * 4 + 2] ?? 0),
    );
  return out;
}

function sobelStrength(l: Float64Array, w: number, h: number): Float64Array {
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx =
        (at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x - 1, y) -
          at(x - 1, y + 1)) /
        8;
      const gy =
        (at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x, y - 1) -
          at(x + 1, y - 1)) /
        8;
      out[y * w + x] = Math.min(1, Math.hypot(gx, gy) * 8);
    }
  return out;
}

const readMap = (page: Page, kind: 'luminance' | 'edges') =>
  page.evaluate(async (k) => {
    const p = window.__bls.getProject();
    const e = window.__bls.getEngine();
    const layer = p?.root.children[0];
    if (!p || !e || !layer) throw new Error('kein Projekt');
    const data = await e.readMap(p, layer.id, k);
    return data ? Array.from(data) : null;
  }, kind);

test.beforeEach(async ({ page }) => {
  await enableTestEffects(page);
  await waitForApp(page);
});

test('Helligkeit und Kantenstärke entsprechen der CPU-Referenz', async ({ page }) => {
  await openFixture(page, 'golden/architecture.png');
  const img = PNG.sync.read(readFileSync(fixture('golden/architecture.png')));
  const lum = luminance(img);
  const strength = sobelStrength(lum, img.width, img.height);
  const gl = await readMap(page, 'luminance');
  const ge = await readMap(page, 'edges');
  if (!gl || !ge) throw new Error('Karte fehlt');
  let dl = 0;
  let de = 0;
  for (let i = 0; i < lum.length; i++) {
    dl = Math.max(dl, Math.abs((gl[i * 4] ?? 0) - (lum[i] ?? 0)));
    de = Math.max(de, Math.abs((ge[i * 4] ?? 0) - (strength[i] ?? 0)));
  }
  console.log(`Karten gegen CPU: Helligkeit max ${dl.toFixed(4)}, Kantenstärke max ${de.toFixed(4)}`);
  expect(dl).toBeLessThan(0.004);
  expect(de).toBeLessThan(0.01);
});

test('Kantenrichtung folgt der Kante; Kohärenz hoch an klaren Kanten', async ({ page }) => {
  // synthetisch: Farbfeld x 100..299, y 75..224 → senkrechte Kante bei x = 100, waagerechte bei y = 75
  await openFixture(page);
  const ge = await readMap(page, 'edges');
  if (!ge) throw new Error('Karte fehlt');
  const at = (x: number, y: number) => {
    const i = (y * 400 + x) * 4;
    const t = [(ge[i + 1] ?? 0) * 2 - 1, (ge[i + 2] ?? 0) * 2 - 1];
    return { strength: ge[i] ?? 0, t, coherence: ge[i + 3] ?? 0 };
  };
  const v = at(100, 150);
  expect(v.strength).toBeGreaterThan(0.5);
  expect(Math.abs(v.t[1] ?? 0)).toBeGreaterThan(0.95);
  expect(v.coherence).toBeGreaterThan(0.8);
  const h = at(200, 75);
  expect(Math.abs(h.t[0] ?? 0)).toBeGreaterThan(0.95);
  // innerhalb der einfarbigen Fläche keine Kante
  expect(at(200, 150).strength).toBeLessThan(0.01);
});

test('Effekte erhalten die Karten (Ebene und Gruppe), Export in Kacheln nahtlos', async ({ page }) => {
  await openFixture(page, 'golden/portrait.png');
  await expect
    .poll(() => page.evaluate(() => window.__bls.plugins.getState().plugins['zz-e2e-maps']?.status))
    .toBe('ok');
  const ge = await readMap(page, 'edges');
  const gl = await readMap(page, 'luminance');
  if (!ge || !gl) throw new Error('Karte fehlt');
  const { layerId, fxId } = await page.evaluate(() => {
    const layer = window.__bls.getProject()?.root.children[0];
    if (!layer) throw new Error('keine Ebene');
    const fxId = window.__bls.commands.addEffectCommand('zz-e2e-maps', layer.id);
    if (!fxId) throw new Error('Effekt fehlt');
    return { layerId: layer.id, fxId };
  });
  const check = (img: PNG, map: number[]) => {
    let worst = 0;
    for (let i = 0; i < img.width * img.height; i++)
      worst = Math.max(worst, Math.abs((img.data[i * 4] ?? 0) - 255 * (map[i * 4] ?? 0)));
    return worst;
  };
  const onLayer = await renderExport(page);
  expect(check(onLayer, ge)).toBeLessThanOrEqual(1.5);
  expect(diffStats(onLayer, await renderExport(page, 64)).max).toBe(0);
  await page.evaluate(
    ({ layerId, fxId }) => {
      window.__bls.commands.setParamCommand(layerId, fxId, 'show', 'luminance', false);
    },
    { layerId, fxId },
  );
  expect(check(await renderExport(page), gl)).toBeLessThanOrEqual(1.5);

  // Gruppe (Wurzel): Karten aus dem Effekt-Eingang – hier gleich der Ebene; Kacheln dank Reichweite nahtlos
  await page.evaluate(
    ({ layerId, fxId }) => {
      const root = window.__bls.getProject()?.root;
      if (!root) throw new Error('kein Projekt');
      window.__bls.commands.removeEffectCommand(layerId, fxId);
      window.__bls.commands.addEffectCommand('zz-e2e-maps', root.id);
    },
    { layerId, fxId },
  );
  const onGroup = await renderExport(page);
  expect(check(onGroup, ge)).toBeLessThanOrEqual(1.5);
  expect(diffStats(onGroup, await renderExport(page, 64)).max).toBe(0);
});

test('Ansicht „Karten“ (Taste 5) mit Kartenwahl und Deckkraft', async ({ page }) => {
  await openFixture(page, 'golden/architecture.png');
  const before = await canvasPixel(page, 0.6, 0.5);
  await page.keyboard.press('5');
  await expect(page.getByTestId('analysis-panel')).toBeVisible();
  const edges = await canvasPixel(page, 0.6, 0.5);
  await page.getByTestId('analysis-panel').getByRole('radio', { name: 'Helligkeit' }).click();
  await page.getByTestId('analysis-opacity').getByLabel('Deckkraft Wert').fill('100');
  await page.keyboard.press('Enter');
  const lumView = await canvasPixel(page, 0.6, 0.5);
  // Helligkeit grau: r = g = b
  expect(Math.max(...lumView) - Math.min(...lumView)).toBeLessThanOrEqual(2);
  expect(edges).not.toEqual(before);
  await page.getByTestId('analysis-opacity').getByLabel('Deckkraft Wert').fill('0');
  await page.keyboard.press('Enter');
  expect(await canvasPixel(page, 0.6, 0.5)).toEqual(before);
  await page.keyboard.press('1');
  await expect(page.getByTestId('analysis-panel')).toBeHidden();
});
