// E1 Schritt 14: PSD – Gruppen (auch mit Effekten) als Ebenengruppen mit Gruppenmaske; Option „Effekte als eigene Ebenen“.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPsd, type Layer as PsdLayer } from 'ag-psd';
import { fixture, openFixture, waitForApp } from './helpers';

/** Gruppe „Szene“ aus Grundbild (mit zwei Effekten) und kleinem Bild; Gruppeneffekt Schwarz-Weiß, Gruppenmaske. */
async function buildScene(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-image-button').click();
  await (await chooser).setFiles(fixture('sharp-256x192.png'));
  await expect.poll(() => page.evaluate(() => window.__bls.getProject()?.root.children.length)).toBe(2);
  await page.evaluate(() => {
    const c = window.__bls.commands;
    const [base, small] = window.__bls.getProject()?.root.children ?? [];
    if (!base || !small) throw new Error('Ebenen fehlen');
    c.setTransformCommand(small.id, { x: 0, y: 0, scale: 0.5, rotation: 0 }, false);
    const blur = c.addEffectCommand('gaussian-blur', base.id);
    const tint = c.addEffectCommand('color-overlay', base.id);
    if (!blur || !tint) throw new Error('Effekte fehlen');
    c.setParamCommand(base.id, blur, 'radius', 8, false);
    c.setEffectMaskCommand(base.id, blur, {
      kind: 'map',
      map: 'luminance',
      from: 0,
      to: 0.5,
      feather: 0.05,
      invert: false,
    });
    c.setStrengthCommand(base.id, tint, 0.6, false);
    c.setEffectBlendCommand(base.id, tint, 'multiply');
    c.groupNodesCommand([base.id, small.id]);
    const g = window.__bls.getProject()?.root.children[0];
    if (g?.kind !== 'group') throw new Error('Gruppe fehlt');
    c.addEffectCommand('black-white', g.id);
    c.setGroupMaskCommand(g.id, { kind: 'layer', layerId: small.id, invert: true });
    c.setNodeOpacityCommand(g.id, 0.8, false);
  });
}

async function exportPsd(
  page: Page,
  effectLayers: boolean,
): Promise<{ psd: ReturnType<typeof readPsd>; path: string }> {
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-psd').check();
  if (effectLayers) await page.getByTestId('export-effect-layers').check();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByTestId('export-start').click();
  const path = await (await download).path();
  const psd = readPsd(readFileSync(path), {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
    useImageData: true,
  });
  return { psd, path };
}

const names = (l: PsdLayer[] | undefined) => (l ?? []).map((x) => x.name);

test('PSD: Gruppe mit Effekt und Maske bleibt Ebenengruppe; Effekte wahlweise als eigene Ebenen', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await waitForApp(page);
  await openFixture(page);
  await buildScene(page);

  // Standard: Effekte eingebrannt, Gruppeneffekt als oberste Ebene der Gruppe, Gruppenmaske aktiv
  const std = (await exportPsd(page, false)).psd;
  expect(names(std.children)).toEqual(['Gruppe']);
  const g = std.children?.[0];
  expect(g?.opacity).toBeCloseTo(0.8, 2);
  expect(g?.mask?.disabled ?? false).toBe(false);
  expect(names(g?.children)).toEqual([
    'synthetic-400x300',
    'sharp-256x192',
    'Gruppe – Schwarz-Weiß (gerendert)',
  ]);

  // Effekte als eigene Ebenen: Ebene → PSD-Gruppe (Basis + je Effekt), Gruppeneffekt als eigene Ebene
  const { psd, path } = await exportPsd(page, true);
  await testInfo.attach('effekte-als-ebenen.psd', { path });
  const grp = psd.children?.[0];
  expect(names(grp?.children)).toEqual(['synthetic-400x300', 'sharp-256x192', 'Schwarz-Weiß']);
  const base = grp?.children?.[0];
  expect(names(base?.children)).toEqual(['synthetic-400x300', 'Gauß-Blur', 'Farb-Overlay']);
  const [, blurL, tintL] = base?.children ?? [];
  expect(blurL?.mask?.disabled ?? false).toBe(false); // Effektmaske aktiv
  expect(blurL?.opacity ?? 1).toBeCloseTo(1, 2);
  expect(tintL?.blendMode).toBe('multiply');
  expect(tintL?.opacity).toBeCloseTo(0.6, 2);
  expect(tintL?.mask).toBeUndefined();
});
