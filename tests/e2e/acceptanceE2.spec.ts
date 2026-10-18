// Abnahme Phase E2 (Spec „Effekte“ Abschnitt 10): Aus einem Foto entsteht eine druckbare PDF-Malmappe mit Werteskizze,
// Raster und gekachelter Konturvorlage im korrekten Maßstab. Dazu: neue Effekte mit Maske, Mischmodus und Stärke im
// Export, Messwerte der Malplan-Analyse und der Malmappe.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { tileLayout } from '../../src/malplan/tiles';
import { PT_PER_CM } from '../../src/io/pdf';
import { addEffect, diffStats, openFixture, renderExport, waitForApp } from './helpers';

test('Abnahme E2: Foto → Effekt → Malplan → druckbare Malmappe im korrekten Maßstab', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await waitForApp(page);
  await openFixture(page, 'photo-portrait-street.jpg');
  // Ein E2-Effekt mit Maske, Mischmodus und halber Stärke wirkt im Export und erzeugt keine ungültigen Werte
  const before = await renderExport(page);
  const { layerId, instanceId } = await addEffect(page, 'charcoal');
  await page.evaluate(
    ({ layerId, instanceId }) => {
      const c = window.__bls.commands;
      c.setStrengthCommand(layerId, instanceId, 0.6, false);
      c.setEffectBlendCommand(layerId, instanceId, 'multiply');
      c.setEffectMaskCommand(layerId, instanceId, {
        kind: 'map',
        map: 'luminance',
        from: 0.3,
        to: 1,
        feather: 0.1,
        invert: false,
      });
    },
    { layerId, instanceId },
  );
  const withFx = await renderExport(page);
  expect(diffStats(before, withFx).mean).toBeGreaterThan(2);
  // ±1 Stufe zwischen Kacheln: Fast-Math des Shader-Compilers (Optimierungen 2.1)
  expect(diffStats(withFx, await renderExport(page, 512)).max).toBeLessThanOrEqual(1);

  // Malplan: Format 50 × 70 cm (hoch), Werteskizze mit 5 Stufen, Raster 4 × 4
  await page.getByTestId('workspace-malplan').click();
  const t0 = Date.now();
  await expect(page.getByTestId('malplan-ready')).toBeAttached({ timeout: 90_000 });
  const firstAnalysis = Date.now() - t0;
  await page.getByTestId('malplan-format').selectOption('frame-50x70');
  await page.getByTestId('malplan-values').getByRole('radio', { name: '5' }).click();
  await expect.poll(() => page.evaluate(() => window.__bls.getProject()?.malplan?.values.levels)).toBe(5);
  const t1 = Date.now();
  await expect(page.getByTestId('malplan-busy')).toBeHidden({ timeout: 90_000 });
  await expect(page.getByTestId('malplan-ready')).toBeAttached({ timeout: 90_000 });
  const reanalysis = Date.now() - t1;
  const settings = await page.evaluate(() => window.__bls.getProject()?.malplan);
  if (!settings) throw new Error('keine Malplan-Einstellungen');
  // Querformat-Foto → Format quer (70 × 50 cm), Zuschnitt im Seitenverhältnis 7 : 5
  expect(settings.format.widthCm).toBe(70);
  expect(settings.format.heightCm).toBe(50);
  const regions = await page.evaluate(() => window.__bls.malplan.getState().result?.regions.length ?? 0);
  expect(regions).toBeGreaterThan(20);
  expect(regions).toBeLessThanOrEqual(settings.shapes);

  // Malmappe erstellen
  await page.getByTestId('pdf-toggle').click();
  const t2 = Date.now();
  const dl = page.waitForEvent('download');
  await page.getByTestId('pdf-create').click();
  const download = await dl;
  const pdfMs = Date.now() - t2;
  const path = testInfo.outputPath('malmappe.pdf');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  const s = bytes.toString('latin1');
  // Seiten: 6 Einzelseiten + Übersicht + Kacheln
  const tiles = tileLayout(70, 50, settings.contour.paper, settings.contour.overlapCm);
  const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)?.[1]);
  expect(pages).toBe(6 + 1 + tiles.cols * tiles.rows);
  expect(s).toContain('(Werteskizze \\(5 Tonwerte\\)) Tj');
  expect(s).toContain('(Raster f\\374r den Untergrund) Tj');
  // Maßstab: Bildrahmen der Konturvorlage = 70 × 50 cm in pt
  const w = (Math.round(70 * PT_PER_CM * 1000) / 1000).toString();
  const h = (Math.round(50 * PT_PER_CM * 1000) / 1000).toString();
  expect(s).toContain(`${w} ${h} re S`);
  // Kontrollmaß 5 cm (141,732 pt lange Linie) auf jedem Kachelblatt
  expect((s.match(/\(5 cm\) Tj/g) ?? []).length).toBe(tiles.cols * tiles.rows);
  const bar =
    /([\d.]+) ([\d.]+) m ([\d.]+) \2 l S\n[\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S\n[\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S\nBT [^\n]*\(5 cm\)/.exec(
      s,
    );
  expect(Number(bar?.[3]) - Number(bar?.[1])).toBeCloseTo(5 * PT_PER_CM, 2);
  const report = [
    'Abnahme E2 (Foto 1600 × 1067, Kohle & Rötel mit Maske/Mischmodus, Malplan 70 × 50 cm):',
    `  erste Malplan-Analyse (Render + Worker): ${(firstAnalysis / 1000).toFixed(1)} s`,
    `  Neuberechnung nach Formatwechsel und 5 Stufen: ${(reanalysis / 1000).toFixed(1)} s`,
    `  Flächen: ${regions}, Malmappe: ${pages} Seiten (${tiles.cols} × ${tiles.rows} Kacheln ${settings.contour.paper}), ${(bytes.length / 1e6).toFixed(1)} MB in ${(pdfMs / 1000).toFixed(1)} s`,
  ].join('\n');
  console.log(report);
  await testInfo.attach('messwerte-e2.txt', { body: report });
});
