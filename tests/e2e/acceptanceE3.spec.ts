// Abnahme E3 (Spec „Effekte“ 10): Person per Klick segmentieren, ihr einen anderen Stil geben als dem Hintergrund,
// Licht nachträglich verschieben, Ergebnis exportieren. Mit Modellen aus dem Test-Cache (SAM 2.1, Depth Anything V2).

import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { fixture, renderExport, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModels =
  existsSync(`${CACHE}sam2.1-tiny-vision_encoder_fp16.onnx_data`) &&
  existsSync(`${CACHE}depth-anything-v2-small-fp16.onnx`);

async function screenPos(page: Page, fx: number, fy: number): Promise<[number, number]> {
  const box = await page.getByTestId('canvas').boundingBox();
  const v = await page.evaluate(
    ({ fx, fy }) => {
      const s = window.__bls.store.getState();
      const p = window.__bls.getProject();
      if (!p) throw new Error('kein Projekt');
      return [
        fx * p.canvas.width * s.view.zoom + s.view.offsetX,
        fy * p.canvas.height * s.view.zoom + s.view.offsetY,
      ];
    },
    { fx, fy },
  );
  return [(box?.x ?? 0) + (v[0] ?? 0), (box?.y ?? 0) + (v[1] ?? 0)];
}

/** Mittlere Sättigung (HSV) und Helligkeit in einem Rechteck (Anteile) */
function stats(img: PNG, x0: number, y0: number, x1: number, y1: number): { sat: number; lum: number } {
  let s = 0;
  let l = 0;
  let n = 0;
  for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++)
    for (let x = Math.floor(x0 * img.width); x < Math.floor(x1 * img.width); x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i] ?? 0;
      const g = img.data[i + 1] ?? 0;
      const b = img.data[i + 2] ?? 0;
      const mx = Math.max(r, g, b);
      s += mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
      l += (r + g + b) / 3;
      n++;
    }
  return { sat: s / n, lum: l / n };
}

/** Anteil der Pixel nahe an Druckfarbe oder Papier des Linolschnitts (Standardfarben, sRGB 8 Bit) */
function twoTone(img: PNG, x0: number, y0: number, x1: number, y1: number): number {
  const ink = [20, 18, 18];
  const paper = [240, 232, 214];
  const near = (i: number, c: number[]) =>
    Math.hypot(
      (img.data[i] ?? 0) - (c[0] ?? 0),
      (img.data[i + 1] ?? 0) - (c[1] ?? 0),
      (img.data[i + 2] ?? 0) - (c[2] ?? 0),
    ) < 40;
  let hit = 0;
  let n = 0;
  for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++)
    for (let x = Math.floor(x0 * img.width); x < Math.floor(x1 * img.width); x++) {
      const i = (y * img.width + x) * 4;
      if (near(i, ink) || near(i, paper)) hit++;
      n++;
    }
  return hit / n;
}

test.describe('Abnahme E3 (mit Modellen)', () => {
  test.skip(!hasModels, 'Modelle fehlen im Test-Cache (npm run models:fetch)');

  test('Person per Klick segmentieren, anderer Stil als der Hintergrund, Licht verschieben, exportieren', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(300_000);
    await context.addInitScript(() => {
      localStorage.setItem('bls.modelMirror', '/__models/');
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    });
    await waitForApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(fixture('photo-portrait-street.jpg'));
    await waitForProject(page);
    const original = await renderExport(page);
    const layerId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');

    // 1. Person per Klick (Smarte Auswahl): Gesicht, dann Jacke dazu
    await page.keyboard.press('w');
    const overlay = page.getByTestId('smart-overlay');
    let t0 = Date.now();
    for (const [fx, fy] of [
      [0.34, 0.42],
      [0.3, 0.85],
    ] as const) {
      const [x, y] = await screenPos(page, fx, fy);
      await page.mouse.click(x, y);
      await expect(overlay).toHaveAttribute('data-busy', '0', { timeout: 120_000 });
    }
    const samMs = Date.now() - t0;
    const sel = await page.evaluate(async (layerId) => {
      const p = window.__bls.getProject();
      if (!p) throw new Error('kein Projekt');
      const d = await window.__bls.getEngine()?.readMap(p, layerId, 'selection');
      const at = (fx: number, fy: number) =>
        d?.[(Math.floor(fy * p.canvas.height) * p.canvas.width + Math.floor(fx * p.canvas.width)) * 4] ?? -1;
      return { face: at(0.34, 0.42), jacket: at(0.3, 0.85), street: at(0.85, 0.5), wall: at(0.06, 0.3) };
    }, layerId);
    expect(sel.face).toBeGreaterThan(0.5);
    expect(sel.jacket).toBeGreaterThan(0.5);
    expect(sel.street).toBeLessThan(0.5);
    expect(sel.wall).toBeLessThan(0.5);

    // als Segment „Person“ speichern (Inspektor)
    await page.keyboard.press('v');
    if (!(await page.getByTestId('segment-name').count()))
      await page.getByTestId('segment-section').getByRole('button', { name: 'Segmente' }).click();
    await page.getByTestId('segment-name').fill('Person');
    await page.getByTestId('segment-save').click();
    const segId = await page.evaluate(() => window.__bls.getProject()?.segments?.[0]?.id ?? '');
    expect(segId).not.toBe('');

    // 2. Stil je Bereich: Person als Ölbild (Kuwahara), Hintergrund als Linolschnitt
    await page.getByTestId('style-regions-open').click();
    const dialog = page.getByTestId('style-regions-dialog');
    await dialog.getByTestId(`region-style-${segId}`).selectOption('fx:kuwahara');
    await dialog.getByTestId('region-style-rest').selectOption('fx:linocut');
    await dialog.getByTestId('region-apply').click();
    await expect(dialog).toBeHidden();
    const styled = await renderExport(page);
    const person = stats(styled, 0.08, 0.82, 0.2, 0.97); // Jacke
    const personOrig = stats(original, 0.08, 0.82, 0.2, 0.97);
    // Hintergrund: Linolschnitt = fast nur Druckfarbe und Papier; Person: Ölbild behält Farbe und Tonwerte
    const bgTwoTone = twoTone(styled, 0.75, 0.3, 0.98, 0.7);
    const personTwoTone = twoTone(styled, 0.08, 0.82, 0.2, 0.97);
    expect(bgTwoTone).toBeGreaterThan(0.75);
    expect(personTwoTone).toBeLessThan(bgTwoTone / 3);
    expect(person.sat).toBeGreaterThan(personOrig.sat * 0.6);

    // 3. Licht nachträglich: „Neu beleuchten“ auf die Gruppe, Tiefe wird automatisch berechnet
    const groupId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
    t0 = Date.now();
    await page.evaluate((groupId) => {
      window.__bls.store.getState().select(groupId);
      if (!window.__bls.commands.addEffectCommand('relight', groupId)) throw new Error('relight fehlt');
    }, groupId);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const p = window.__bls.getProject();
            const id = Object.keys(p?.originals ?? {})[0] ?? '';
            return p?.analysis?.[id]?.depth?.provenance.modelId ?? null;
          }),
        { timeout: 120_000 },
      )
      .toBe('depth-anything-v2-small');
    const depthMs = Date.now() - t0;
    const litLeft = await renderExport(page);
    // Lichtquelle von links oben nach rechts ziehen
    const handle = page.getByTestId('point-handle-light');
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('kein Griff');
    const [tx, ty] = await screenPos(page, 0.9, 0.35);
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 8 });
    await page.mouse.up();
    const litRight = await renderExport(page);
    const face = (img: PNG, x0: number, x1: number) => stats(img, x0, 0.32, x1, 0.55).lum;
    // rechte Gesichtshälfte heller als vorher, linke dunkler
    expect(face(litRight, 0.36, 0.42)).toBeGreaterThan(face(litLeft, 0.36, 0.42));
    expect(face(litRight, 0.27, 0.32)).toBeLessThan(face(litLeft, 0.27, 0.32));

    // 4. Exportieren (Dialog, PNG in voller Auflösung)
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-png').check();
    t0 = Date.now();
    const dl = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-start').click();
    const file = await (await dl).path();
    const exportMs = Date.now() - t0;
    const png = PNG.sync.read(readFileSync(file));
    expect([png.width, png.height]).toEqual([original.width, original.height]);
    // exportierte Datei = gerendertes Ergebnis
    let maxDiff = 0;
    for (let i = 0; i < png.data.length; i += 97)
      maxDiff = Math.max(maxDiff, Math.abs((png.data[i] ?? 0) - (litRight.data[i] ?? 0)));
    expect(maxDiff).toBeLessThanOrEqual(2);

    const report = [
      `Abnahme E3 (Straßenporträt ${original.width} × ${original.height}):`,
      `  Smarte Auswahl (2 Klicks, inkl. Modell laden): ${samMs} ms`,
      `  Tiefenkarte automatisch: ${depthMs} ms`,
      `  Linolschnitt-Anteil Hintergrund ${(bgTwoTone * 100).toFixed(0)} %, Person ${(personTwoTone * 100).toFixed(0)} %`,
      `  Sättigung Jacke: Original ${personOrig.sat.toFixed(2)}, Ölbild ${person.sat.toFixed(2)}`,
      `  Gesicht rechts: Licht links ${face(litLeft, 0.36, 0.42).toFixed(0)} → rechts ${face(litRight, 0.36, 0.42).toFixed(0)}`,
      `  Export PNG: ${exportMs} ms`,
    ].join('\n');
    console.log(report);
    await testInfo.attach('messwerte-e3.txt', { body: report });
  });
});
