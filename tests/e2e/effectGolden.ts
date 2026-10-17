// Golden-Infrastruktur für Effekte (Spec „Effekte“, Abschnitt 9): Für jeden Fall wird ein kleines Testfoto mit festem
// Effekt, Parametern (und Seed) gerendert und geprüft:
//   1. Vergleich mit tests/golden/effects/<name>.png (Toleranz; UPDATE_GOLDEN=1 schreibt die Referenz neu)
//   2. gekachelter Export = Export am Stück (keine Nähte)
//   3. keine NaN/Inf-Werte im Arbeitsformat
//   4. optional: eine gleichmäßig graue Fläche bleibt bis zum Rand gleichmäßig (keine Randartefakte)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { diffStats, openFixture, renderExport } from './helpers';

export type GoldenFixture = 'portrait' | 'landscape' | 'architecture' | 'still-life';

export type EffectCase = {
  /** Dateiname der Referenz (ohne .png) */
  name: string;
  fixture: GoldenFixture;
  effectId: string;
  /** Preset aus dem Manifest (zuerst angewendet) */
  preset?: string;
  params?: Record<string, unknown>;
  /** zulässige Abweichung zur Referenz (8-Bit-Stufen); Standard max 2, Mittel 0,1 */
  tolerance?: { max: number; mean: number };
  /** zulässige Abweichung gekachelt vs. am Stück (Standard 0) */
  tileTolerance?: number;
  /**
   * Randprüfung auf grauer Fläche: maximale Abweichung zwischen Rand- und Mittelpixel (8-Bit), oder false für Effekte,
   * die eine Fläche absichtlich ungleichmäßig machen (Korn, Raster, Vignette …).
   */
  flatBorder?: number | false;
};

const GOLDEN_DIR = new URL('../golden/effects/', import.meta.url).pathname;

/** Öffnet ein Testbild, legt den Effekt auf die erste Ebene und setzt Preset/Parameter. */
export async function applyEffect(page: Page, c: EffectCase, fixtureFile: string): Promise<void> {
  await openFixture(page, fixtureFile);
  // Plugin muss fehlerfrei geladen und kompiliert sein (sonst würde der Effekt still übersprungen)
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const p = window.__bls.plugins.getState().plugins[id];
          return p ? `${p.status} ${p.errors.join(' | ')}`.trim() : 'fehlt';
        }, c.effectId),
      { timeout: 15_000 },
    )
    .toBe('ok');
  await page.evaluate(
    ({ effectId, preset, params }) => {
      const bls = window.__bls;
      const layer = bls.getProject()?.root.children[0];
      if (!layer) throw new Error('keine Ebene');
      const id = bls.commands.addEffectCommand(effectId, layer.id);
      if (!id) throw new Error(`Effekt ${effectId} nicht verfügbar`);
      if (preset) {
        const manifest = bls.plugins.getState().plugins[effectId]?.manifest;
        const p = manifest?.presets?.find((x) => x.name === preset);
        if (!p) throw new Error(`Preset ${preset} fehlt`);
        bls.commands.applyPresetCommand(layer.id, id, p.name, p.values);
      }
      for (const [k, v] of Object.entries(params))
        bls.commands.setParamCommand(layer.id, id, k, v as never, false);
    },
    { effectId: c.effectId, preset: c.preset ?? null, params: c.params ?? {} },
  );
}

export function compareGolden(
  name: string,
  got: PNG,
  testInfo: TestInfo,
  tol: { max: number; mean: number },
): void {
  const path = `${GOLDEN_DIR}${name}.png`;
  if (process.env.UPDATE_GOLDEN || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, PNG.sync.write(got));
    console.log(`Golden geschrieben: ${name}.png`);
    return;
  }
  const want = PNG.sync.read(readFileSync(path));
  expect([got.width, got.height], `${name}: Größe`).toEqual([want.width, want.height]);
  const d = diffStats(got, want);
  if (d.max > tol.max || d.mean > tol.mean)
    writeFileSync(testInfo.outputPath(`${name}-got.png`), PNG.sync.write(got));
  console.log(`Golden ${name}: max ${d.max}, Mittel ${d.mean.toFixed(3)}`);
  expect(d.max, `${name}: maximale Abweichung`).toBeLessThanOrEqual(tol.max);
  expect(d.mean, `${name}: mittlere Abweichung`).toBeLessThanOrEqual(tol.mean);
}

/** Führt alle Prüfungen für einen Fall aus. */
export async function checkEffect(page: Page, c: EffectCase, testInfo: TestInfo): Promise<void> {
  await applyEffect(page, c, `golden/${c.fixture}.png`);
  const whole = await renderExport(page);
  compareGolden(c.name, whole, testInfo, c.tolerance ?? { max: 2, mean: 0.1 });

  const tiled = await renderExport(page, 64);
  expect(diffStats(whole, tiled).max, `${c.name}: Kachelnaht`).toBeLessThanOrEqual(c.tileTolerance ?? 0);

  const stats = await page.evaluate(async () => {
    const p = window.__bls.getProject();
    const e = window.__bls.getEngine();
    if (!p || !e) throw new Error('kein Projekt');
    return e.floatStats(p);
  });
  expect(stats.nonFinite, `${c.name}: NaN/Inf`).toBe(0);

  if (c.flatBorder !== false) {
    await applyEffect(page, c, 'golden/flat-gray.png');
    const flat = await renderExport(page);
    const at = (x: number, y: number) => {
      const i = (y * flat.width + x) * 4;
      return [flat.data[i] ?? 0, flat.data[i + 1] ?? 0, flat.data[i + 2] ?? 0, flat.data[i + 3] ?? 0];
    };
    const center = at(flat.width >> 1, flat.height >> 1);
    let worst = 0;
    for (let x = 0; x < flat.width; x++)
      for (const y of [0, 1, flat.height - 2, flat.height - 1])
        worst = Math.max(worst, ...at(x, y).map((v, k) => Math.abs(v - (center[k] ?? 0))));
    for (let y = 0; y < flat.height; y++)
      for (const x of [0, 1, flat.width - 2, flat.width - 1])
        worst = Math.max(worst, ...at(x, y).map((v, k) => Math.abs(v - (center[k] ?? 0))));
    expect(worst, `${c.name}: Randartefakt auf grauer Fläche`).toBeLessThanOrEqual(c.flatBorder ?? 1);
  }
}
