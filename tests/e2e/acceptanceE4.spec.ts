// Abnahme Phase E4 (Spec „Effekte“ Abschnitt 10): Mit einer Palette von 10 eigenen Farben entsteht für ein Foto eine
// vollständige Malmappe inkl. Mischrezepten, Kanten-Karte und Schichtplan. Dazu Pinselstriche als Effekt (Strichdaten
// für die Strichführung) und Messwerte.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { pdfString } from '../../src/io/pdf';
import { tileLayout } from '../../src/malplan/tiles';
import { openFixture, waitForApp } from './helpers';

/** 10 eigene Farben (bewusst nicht die Standardpalette) mit Namen wie in der Pigmentdatenbank */
const MY: Record<string, string> = {
  'titanium-white': 'Titanweiß',
  'mars-black': 'Marsschwarz',
  'cobalt-blue': 'Kobaltblau',
  cerulean: 'Cölinblau',
  'lemon-yellow': 'Zitronengelb',
  'cadmium-yellow-medium': 'Kadmiumgelb mittel',
  'raw-sienna': 'Siena natur',
  'burnt-umber': 'Umbra gebrannt',
  'pyrrole-red': 'Pyrrolrot',
  viridian: 'Viridian',
};

test('Abnahme E4: 10 eigene Farben → vollständige Malmappe mit Mischrezepten, Kanten-Karte und Schichtplan', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await waitForApp(page);
  await openFixture(page, 'photo-portrait-street.jpg');
  // Pinselstriche auf dem Foto: deren Strichdaten liefern die Strichführung
  await page.evaluate(() => {
    const l = window.__bls.getProject()?.root.children[0];
    if (!l || !window.__bls.commands.addEffectCommand('stroke-paint', l.id))
      throw new Error('stroke-paint fehlt');
  });
  await page.getByTestId('workspace-malplan').click();
  await expect(page.getByTestId('malplan-ready')).toBeAttached({ timeout: 120_000 });

  // „Meine Farben“ in der Oberfläche wählen: genau die 10 eigenen Farben
  await page
    .getByTestId('malplan-mycolors')
    .getByRole('button', { name: /Meine Farben/ })
    .click();
  const list = page.getByTestId('pigment-list');
  const ids = await list
    .locator('input[type=checkbox]')
    .evaluateAll((els) =>
      els.map((e) => ({
        id: e.getAttribute('data-testid')?.slice(8) ?? '',
        checked: (e as HTMLInputElement).checked,
      })),
    );
  // erst die gewünschten an-, dann die übrigen abwählen (mindestens eine Farbe bleibt immer gewählt)
  for (const { id, checked } of ids) if (MY[id] && !checked) await page.getByTestId(`pigment-${id}`).check();
  for (const { id, checked } of ids)
    if (!MY[id] && checked) await page.getByTestId(`pigment-${id}`).uncheck();
  await expect
    .poll(() =>
      page.evaluate(() => [...(window.__bls.getProject()?.malplan?.myColors ?? [])].sort().join(',')),
    )
    .toBe(Object.keys(MY).sort().join(','));
  // Profil speichern (Browser-Speicher)
  await page.getByLabel('Name des Profils').fill('Meine Ölpalette');
  await page.getByRole('button', { name: 'Als Profil speichern' }).click();
  expect(await page.evaluate(() => localStorage.getItem('bls.colorProfiles'))).toContain('Meine Ölpalette');

  // Technik Öl, Palette neu berechnet
  await page.evaluate(() => {
    window.__bls.commands.setMalplanCommand({ technique: 'oil' }, false);
  });
  const t0 = Date.now();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const st = window.__bls.malplan.getState();
          const my = window.__bls.getProject()?.malplan?.myColors ?? [];
          return (
            st.status === 'ready' &&
            (st.palette?.entries ?? []).every((e) => e.recipe.every((p) => my.includes(p.id))) &&
            st.plan?.steps.length === 6
          );
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
  const recalcMs = Date.now() - t0;
  const pal = await page.evaluate(() => window.__bls.malplan.getState().palette);
  const entries = pal?.entries ?? [];
  expect(entries.length).toBe(12);
  const dEs = entries.map((e) => e.deltaE).sort((a, b) => a - b);
  const median = dEs[Math.floor(dEs.length / 2)] ?? 99;
  const good = dEs.filter((d) => d < 5).length;
  expect(good).toBeGreaterThanOrEqual(9);
  expect(median).toBeLessThan(3);
  const guide = await page.evaluate(() => window.__bls.malplan.getState().guide?.source);
  expect(guide).toBe('stroke-paint');

  // PDF-Malmappe (alle Seiten)
  await page.getByTestId('pdf-toggle').click();
  const t1 = Date.now();
  const dl = page.waitForEvent('download');
  await page.getByTestId('pdf-create').click();
  const download = await dl;
  const pdfMs = Date.now() - t1;
  const path = testInfo.outputPath('malmappe-e4.pdf');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  const s = bytes.toString('latin1');
  const settings = await page.evaluate(() => window.__bls.getProject()?.malplan);
  if (!settings) throw new Error('keine Malplan-Einstellungen');
  const tiles = tileLayout(
    settings.format.widthCm,
    settings.format.heightCm,
    settings.contour.paper,
    settings.contour.overlapCm,
  );
  const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)?.[1]);
  // Deckblatt, Werte, Notan, Warm-Kalt, Palette (1–2), Farbfeld, Kanten, 6 Schritte, Strichführung, Raster, Rasterblatt,
  // Übersicht + Kacheln
  const fixed = 4 + 1 + 1 + 6 + 1 + 2 + 1 + tiles.cols * tiles.rows;
  expect(pages).toBeGreaterThanOrEqual(fixed + 1);
  expect(pages).toBeLessThanOrEqual(fixed + 2);
  const has = (text: string) => s.includes(`${pdfString(text)} Tj`);
  // Mischrezepte: Seite, Rezepte nur aus den eigenen Farben, Meine Farben aufgeführt
  expect(has('Palette und Mischrezepte (12 Farben)')).toBe(true);
  expect(has('Meine Farben')).toBe(true);
  const recipeLines = [...s.matchAll(/\((\d+ Teile? [^)]*|etwas [^)]*)\) Tj/g)].map((m) => m[1] ?? '');
  expect(recipeLines.length).toBeGreaterThanOrEqual(12);
  const allNames = Object.values(MY).map((n) => pdfString(n).slice(1, -1));
  for (const line of recipeLines.slice(0, 12))
    expect(
      allNames.some((n) => line.includes(n)),
      line,
    ).toBe(true);
  // Kanten-Karte mit Legende
  expect(has('Kanten-Karte')).toBe(true);
  expect(has('hart – scharf malen')).toBe(true);
  // Schichtplan: 6 Schritte (Öl), je Seite
  for (let k = 1; k <= 6; k++)
    expect(s).toContain(pdfString(`Schichtplan – Schritt ${k} von 6`).slice(0, -1));
  expect(has('Schichtplan – Schritt 1 von 6: Untermalung')).toBe(true);
  // Farbfeld-Karte, Strichführung aus den Pinselstrichen
  expect(has('Farbfeld-Karte')).toBe(true);
  expect(has('Strichführung')).toBe(true);
  expect(s).toContain(pdfString('Aus den Strichdaten des Effekts „Pinselstriche“').slice(1, -1));
  // Konturvorlage weiter maßstäblich
  expect(s).toContain('(5 cm) Tj');

  const report = [
    `Abnahme E4 (Straßenporträt, Öl, ${settings.format.widthCm} × ${settings.format.heightCm} cm, 10 eigene Farben):`,
    `  Palette 12 Farben: dE Median ${median.toFixed(1)}, ${good} von 12 unter 5, größte Abweichung ${(dEs[dEs.length - 1] ?? 0).toFixed(1)}`,
    `  Neuberechnung Palette + Schichtplan + Strichführung nach Wechsel der Farben/Technik: ${recalcMs} ms`,
    `  Malmappe: ${pages} Seiten, ${(bytes.length / 1e6).toFixed(1)} MB in ${(pdfMs / 1000).toFixed(1)} s`,
  ].join('\n');
  console.log(report);
  await testInfo.attach('messwerte-e4.txt', { body: report });
});
