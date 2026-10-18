// Abnahme Phase 5 (Basis-Spec): Hand markieren, als eigenen Layer hervorheben, schärfer stellen; danach per Undo
// vollständig zurück. Markiert wird mit der Smarten Auswahl (SAM) und mit dem Pinsel verfeinert.

import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { PNG } from 'pngjs';
import { addEffect, diffStats, fixture, renderExport, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModel = existsSync(`${CACHE}sam2.1-tiny-vision_encoder_fp16.onnx_data`);

/** Varianz des Laplace-Operators (Schärfemaß) in einem Rechteck (Anteile 0..1) eines PNG. */
function sharpness(img: PNG, x0: number, y0: number, x1: number, y1: number): number {
  const w = img.width;
  const g = (x: number, y: number) => img.data[(y * w + x) * 4] ?? 0;
  const vals: number[] = [];
  for (let y = Math.floor(y0 * img.height) + 1; y < Math.floor(y1 * img.height) - 1; y++)
    for (let x = Math.floor(x0 * w) + 1; x < Math.floor(x1 * w) - 1; x++)
      vals.push(4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1));
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  return vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
}

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

test.describe('Abnahme Phase 5 (mit Modell)', () => {
  test.skip(!hasModel, 'SAM fehlt im Test-Cache (npm run models:fetch)');

  test('Hand markieren → hervorheben → schärfer; Undo stellt alles wieder her', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(240_000);
    await context.addInitScript(() => {
      localStorage.setItem('bls.modelMirror', '/__models/');
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    });
    await waitForApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(fixture('photo-portrait-hand.jpg'));
    await waitForProject(page);
    const original = await renderExport(page);
    const historyStart = await page.evaluate(() => window.__bls.store.getState().history?.index ?? -1);

    // ganzes Bild unscharf
    await addEffect(page, 'gaussian-blur', { radius: 40 });
    const blurred = await renderExport(page);
    const HAND = [0.6, 0.62, 0.7, 0.72] as const; // Hand und Handgelenk (ohne die angrenzende Wange)
    const sOrig = sharpness(original, ...HAND);
    const sBlur = sharpness(blurred, ...HAND);
    expect(sBlur).toBeLessThan(sOrig * 0.3);

    // Smarte Auswahl: Klick auf die Hand
    await page.keyboard.press('w');
    const overlay = page.getByTestId('smart-overlay');
    const [hx, hy] = await screenPos(page, 0.645, 0.57);
    await page.mouse.click(hx, hy);
    await expect(overlay).toHaveAttribute('data-busy', '0', { timeout: 120_000 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const l = window.__bls.getProject()?.root.children[0];
          return l?.kind === 'layer' ? l.selection?.base.kind : '';
        }),
      )
      .toBe('stored');
    // ein Klick auf die Hand erfasst oft die ganze Person: Gesicht und Bart per Alt-Klick ausnehmen
    for (const [fx, fy] of [
      [0.45, 0.35],
      [0.42, 0.6],
    ] as const) {
      const [nx, ny] = await screenPos(page, fx, fy);
      await page.keyboard.down('Alt');
      await page.mouse.click(nx, ny);
      await page.keyboard.up('Alt');
      await expect(overlay).toHaveAttribute('data-busy', '0', { timeout: 120_000 });
    }
    // Pinsel: Handgelenk dazumalen
    await page.keyboard.press('b');
    await page.evaluate(() => {
      window.__bls.store
        .getState()
        .setBrush({ target: 'selection', mode: 'add', size: 60, softness: 0.4, flow: 1 });
    });
    const [ax, ay] = await screenPos(page, 0.63, 0.66);
    const [bx, by] = await screenPos(page, 0.66, 0.74);
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(bx, by, { steps: 8 });
    await page.mouse.up();
    const strokes = await page.evaluate(() => {
      const l = window.__bls.getProject()?.root.children[0];
      return l?.kind === 'layer' ? (l.selection?.strokes.length ?? 0) : 0;
    });
    expect(strokes).toBe(1);
    // Markierung prüfen: Hand ja, Auge nein
    const sel = await page.evaluate(async () => {
      const p = window.__bls.getProject();
      const layer = p?.root.children[0];
      if (!p || !layer) throw new Error('kein Projekt');
      const d = await window.__bls.getEngine()?.readMap(p, layer.id, 'selection');
      const at = (fx: number, fy: number) =>
        d?.[(Math.floor(fy * p.canvas.height) * p.canvas.width + Math.floor(fx * p.canvas.width)) * 4] ?? -1;
      return { hand: at(0.645, 0.57), wrist: at(0.645, 0.7), eye: at(0.43, 0.33), bg: at(0.9, 0.1) };
    });
    expect(sel.hand).toBeGreaterThan(0.5);
    expect(sel.wrist).toBeGreaterThan(0.5);
    expect(sel.eye).toBeLessThan(0.5);
    expect(sel.bg).toBeLessThan(0.5);

    // Hervorheben: neue Ebene ohne Unschärfe → Hand scharf, Rest bleibt unscharf
    await page.getByTestId('highlight').click();
    const sharp = await renderExport(page);
    const sHigh = sharpness(sharp, ...HAND);
    expect(sHigh).toBeGreaterThan(sBlur * 3);
    expect(sHigh).toBeGreaterThan(sOrig * 0.6);
    // Augenbereich bleibt unscharf (nur feiner Auslauf der hochskalierten Maske: höchstens wenige Stufen)
    let eyeMax = 0;
    let eyeSum = 0;
    let eyeN = 0;
    for (let y = Math.floor(0.3 * sharp.height); y < Math.floor(0.36 * sharp.height); y++)
      for (let x = Math.floor(0.38 * sharp.width); x < Math.floor(0.48 * sharp.width); x++) {
        const k = (y * sharp.width + x) * 4;
        const d = Math.abs((sharp.data[k] ?? 0) - (blurred.data[k] ?? 0));
        eyeMax = Math.max(eyeMax, d);
        eyeSum += d;
        eyeN++;
      }
    expect(eyeMax).toBeLessThanOrEqual(8);
    expect(eyeSum / eyeN).toBeLessThan(0.5);
    const layers = await page.evaluate(() => window.__bls.getProject()?.root.children.map((n) => n.name));
    expect(layers?.length).toBe(2);

    // Undo bis zum Anfang: Projekt und Bild wie vorher
    let steps = 0;
    while ((await page.evaluate(() => window.__bls.store.getState().history?.index ?? -1)) > historyStart) {
      await page.getByTestId('undo').click();
      steps++;
      if (steps > 30) throw new Error('Undo endet nicht');
    }
    const state = await page.evaluate(() => {
      const r = window.__bls.getProject()?.root.children ?? [];
      const l = r[0];
      return { n: r.length, effects: l?.effects.length ?? -1, sel: l?.kind === 'layer' && !!l.selection };
    });
    expect(state).toEqual({ n: 1, effects: 0, sel: false });
    expect(diffStats(original, await renderExport(page)).max).toBe(0);
    const report = [
      'Abnahme Phase 5 (Porträt 1280 × 1600, Hand):',
      `  Schärfe (Laplace-Varianz) im Handbereich: Original ${sOrig.toFixed(0)}, unscharf ${sBlur.toFixed(0)}, hervorgehoben ${sHigh.toFixed(0)}`,
      `  Undo-Schritte bis zum Ausgangszustand: ${steps}`,
    ].join('\n');
    console.log(report);
    await testInfo.attach('messwerte-p5.txt', { body: report });
  });
});
