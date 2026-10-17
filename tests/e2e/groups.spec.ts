// E1 Schritt 6a (Spec-Ergänzung 2.2a): Gruppen – zusammenführen, dann Effekte, dann Maske, Deckkraft, Mischmodus.

import { expect, test, type Page } from '@playwright/test';
import type { PNG } from 'pngjs';
import { diffStats, fixture, openFixture, renderExport, waitForApp } from './helpers';

/** Synthetisches Bild + kleineres Bild (mittig, 1:1) in einer Gruppe „G“; liefert IDs. */
async function buildGroup(page: Page): Promise<{ groupId: string; base: string; small: string }> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  await (await chooser).setFiles(fixture('sharp-256x192.png'));
  await expect.poll(() => page.evaluate(() => window.__bls.getProject()?.root.children.length)).toBe(2);
  return page.evaluate(() => {
    const c = window.__bls.commands;
    const p0 = window.__bls.getProject();
    const [base, small] = p0?.root.children ?? [];
    if (!base || !small) throw new Error('Ebenen fehlen');
    c.setTransformCommand(small.id, { x: 0, y: 0, scale: 1, rotation: 0 }, false);
    c.groupNodeCommand(base.id);
    const g = window.__bls.getProject()?.root.children[0];
    if (g?.kind !== 'group') throw new Error('Gruppe fehlt');
    c.moveNodeCommand(small.id, g.id, 1);
    return { groupId: g.id, base: base.id, small: small.id };
  });
}

const alphaAt = (img: PNG, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3] ?? -1;
const rgbAt = (img: PNG, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
};

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);
});

test('Gruppe: Effekt auf das zusammengeführte Ergebnis, danach Maske aus einer Ebene', async ({ page }) => {
  const { groupId, small } = await buildGroup(page);
  const plain = await renderExport(page);
  await page.evaluate((gid) => {
    window.__bls.commands.addEffectCommand('black-white', gid);
  }, groupId);
  const gray = await renderExport(page);
  // beide Ebenen sind grau (Effekt wirkt auf das Gruppenergebnis)
  for (const [x, y] of [
    [20, 20],
    [200, 150],
  ] as const) {
    const [r, g, b] = rgbAt(gray, x, y);
    expect(Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0)).toBeLessThanOrEqual(1);
  }
  expect(diffStats(plain, gray).mean).toBeGreaterThan(5);

  // Gruppenmaske = Bildfläche der kleinen Ebene (Rechteck 256 × 192 mittig: x 72..327, y 54..245)
  await page.evaluate(
    ({ gid, small }) => {
      window.__bls.commands.setGroupMaskCommand(gid, { kind: 'layer', layerId: small, invert: false });
    },
    { gid: groupId, small },
  );
  const masked = await renderExport(page);
  expect(alphaAt(masked, 20, 20)).toBe(0);
  expect(alphaAt(masked, 200, 150)).toBe(255);
  expect(rgbAt(masked, 200, 150)).toEqual(rgbAt(gray, 200, 150));
  expect(diffStats(masked, await renderExport(page, 64)).max).toBe(0);

  // Deckkraft der Gruppe wirkt nach der Maske
  await page.evaluate((gid) => {
    window.__bls.commands.setNodeOpacityCommand(gid, 0.5, false);
  }, groupId);
  expect(Math.abs(alphaAt(await renderExport(page), 200, 150) - 128)).toBeLessThanOrEqual(1);
});

test('Gruppenmaske aus dem Helligkeitsbereich des Gruppenergebnisses', async ({ page }) => {
  const { groupId } = await buildGroup(page);
  const plain = await renderExport(page);
  await page.evaluate((gid) => {
    window.__bls.commands.setGroupMaskCommand(gid, {
      kind: 'map',
      map: 'luminance',
      from: 0,
      to: 0.4,
      feather: 0.02,
      invert: false,
    });
  }, groupId);
  const got = await renderExport(page);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const enc = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  let checked = 0;
  for (let y = 0; y < got.height; y += 3)
    for (let x = 0; x < got.width; x += 3) {
      if (alphaAt(plain, x, y) !== 255) continue;
      const [r, g, b] = rgbAt(plain, x, y);
      const l = enc(0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0));
      if (l < 0.35) {
        expect(alphaAt(got, x, y)).toBe(255);
        checked++;
      } else if (l > 0.45) {
        expect(alphaAt(got, x, y)).toBe(0);
        checked++;
      }
    }
  expect(checked).toBeGreaterThan(2000);
});

test('Effekt auf der Gruppe mit Kantenmaske aus seinem Eingang: Kacheln nahtlos', async ({ page }) => {
  const { groupId } = await buildGroup(page);
  await page.evaluate((gid) => {
    const fx = window.__bls.commands.addEffectCommand('gaussian-blur', gid);
    if (!fx) throw new Error('Effekt fehlt');
    window.__bls.commands.setParamCommand(gid, fx, 'radius', 9, false);
    window.__bls.commands.setEffectMaskCommand(gid, fx, {
      kind: 'map',
      map: 'edges',
      from: 0.2,
      to: 1,
      feather: 0.05,
      invert: false,
    });
  }, groupId);
  const whole = await renderExport(page);
  expect(diffStats(whole, await renderExport(page, 64)).max).toBeLessThanOrEqual(1);
});

test('Maske der Gruppe in der Oberfläche; Undo', async ({ page }) => {
  const { groupId, small } = await buildGroup(page);
  await page.locator(`[data-testid="layer-row-group"][data-id="${groupId}"]`).click();
  const section = page.getByTestId('group-mask');
  await section.getByRole('button', { name: 'Maske der Gruppe' }).click();
  await section.getByTestId('group-mask-select').selectOption(`layer:${small}`);
  const mask = () =>
    page.evaluate((gid) => {
      const g = window.__bls.getProject()?.root.children.find((c) => c.id === gid);
      return g?.kind === 'group' ? (g.mask ?? null) : 'keine Gruppe';
    }, groupId);
  expect(await mask()).toEqual({ kind: 'layer', layerId: small, invert: false });
  await section.getByTestId('group-mask-select').selectOption('map:edges');
  await expect(section.getByTestId('group-mask-to')).toBeVisible();
  await page.keyboard.press('Meta+z');
  expect(await mask()).toEqual({ kind: 'layer', layerId: small, invert: false });
});

test('Mehrere Ebenen mit ⌘-Klick auswählen und zu einer Gruppe zusammenfassen', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  await (await chooser).setFiles(fixture('sharp-256x192.png'));
  await expect.poll(() => page.evaluate(() => window.__bls.getProject()?.root.children.length)).toBe(2);
  const rows = page.getByTestId('layer-row-layer');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Meta'] });
  await expect(page.locator('.layer-row.extra')).toHaveCount(1);
  await page.getByTestId('group-button').click();
  const tree = await page.evaluate(() =>
    window.__bls
      .getProject()
      ?.root.children.map((c) => (c.kind === 'group' ? { [c.name]: c.children.map((x) => x.name) } : c.name)),
  );
  expect(tree).toEqual([{ Gruppe: ['synthetic-400x300', 'sharp-256x192'] }]);
  await page.keyboard.press('Meta+z');
  expect(await page.evaluate(() => window.__bls.getProject()?.root.children.length)).toBe(2);
});
