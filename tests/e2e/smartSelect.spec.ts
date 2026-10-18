// Phase 5: Smarte Auswahl mit SAM 2.1 Tiny im Browser (Modell aus tests/.cache/models über den lokalen Spiegel).
import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fixture, waitForApp, waitForProject } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const hasModel = [
  'sam2.1-tiny-vision_encoder_fp16.onnx',
  'sam2.1-tiny-vision_encoder_fp16.onnx_data',
  'sam2.1-tiny-prompt_encoder_mask_decoder_fp16.onnx',
  'sam2.1-tiny-prompt_encoder_mask_decoder_fp16.onnx_data',
].every((f) => existsSync(CACHE + f));

const selectionMap = (page: Page) =>
  page.evaluate(async () => {
    const p = window.__bls.getProject();
    const layer = p?.root.children[0];
    if (!p || !layer) throw new Error('kein Projekt');
    const d = await window.__bls.getEngine()?.readMap(p, layer.id, 'selection');
    if (!d) return null;
    const w = p.canvas.width;
    const h = p.canvas.height;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) > 0.5) n++;
    const at = (fx: number, fy: number) => d[(Math.floor(fy * h) * w + Math.floor(fx * w)) * 4] ?? 0;
    return { share: n / (w * h), at: [at(0.35, 0.4), at(0.8, 0.15)] };
  });

test.describe('Smarte Auswahl (mit Modell)', () => {
  test.skip(!hasModel, 'SAM fehlt im Test-Cache (npm run models:fetch)');

  test('Klick ins Gesicht markiert das Gesicht, Alt-Klick nimmt aus, ⇧-Klick beginnt neu, Undo', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await context.addInitScript(() => {
      localStorage.setItem('bls.modelMirror', '/__models/');
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
    });
    await waitForApp(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-button').click();
    await (await chooser).setFiles(fixture('photo-portrait-street.jpg'));
    await waitForProject(page);
    await page.keyboard.press('w');
    const overlay = page.getByTestId('smart-overlay');
    await expect(overlay).toBeVisible();
    // Bildposition (35 %, 40 %) = Gesicht; Leinwand-px → Bildschirm über die Ansicht
    const clickAt = async (fx: number, fy: number, mods: ('Alt' | 'Shift')[] = []) => {
      const pos = await page.evaluate(
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
      const box = await overlay.boundingBox();
      if (!box) throw new Error('kein Overlay');
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.click(box.x + (pos[0] ?? 0), box.y + (pos[1] ?? 0));
      for (const m of mods) await page.keyboard.up(m);
      await expect(overlay).toHaveAttribute('data-busy', '0', { timeout: 120_000 });
    };
    const t0 = Date.now();
    await clickAt(0.35, 0.4);
    const firstMs = Date.now() - t0;
    await expect
      .poll(async () => (await selectionMap(page))?.share ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0.02);
    const face = await selectionMap(page);
    expect(face?.at[0]).toBeGreaterThan(0.5); // Gesicht markiert
    expect(face?.at[1]).toBeLessThan(0.5); // Hintergrund oben rechts nicht
    expect(face?.share).toBeLessThan(0.3);
    const prov = await page.evaluate(() => {
      const l = window.__bls.getProject()?.root.children[0];
      return l?.kind === 'layer' && l.selection?.base.kind === 'stored'
        ? l.selection.base.provenance.modelId
        : '';
    });
    expect(prov).toBe('sam2.1-tiny');
    // zweiter Klick (Merkmale zwischengespeichert) ist schnell: Jacke dazu
    const t1 = Date.now();
    await clickAt(0.3, 0.85);
    const secondMs = Date.now() - t1;
    const withJacket = await selectionMap(page);
    expect(withJacket?.share).toBeGreaterThan(face?.share ?? 1);
    // Alt-Klick auf die Jacke: gehört nicht dazu → Markierung wieder kleiner, Gesicht bleibt
    await clickAt(0.3, 0.85, ['Alt']);
    const clicks = await page.evaluate(() => {
      const l = window.__bls.getProject()?.root.children[0];
      return l?.kind === 'layer' ? (l.selection?.clicks ?? []) : [];
    });
    expect(clicks.length / 3).toBe(3);
    expect(clicks[8]).toBe(0);
    const without = await selectionMap(page);
    expect(without?.share).toBeLessThan(withJacket?.share ?? 0);
    expect(without?.at[0]).toBeGreaterThan(0.5);
    // ⇧-Klick: neues Objekt, nur ein Klick
    await clickAt(0.35, 0.4, ['Shift']);
    const fresh = await page.evaluate(() => {
      const l = window.__bls.getProject()?.root.children[0];
      return l?.kind === 'layer' ? (l.selection?.clicks ?? []) : [];
    });
    expect(fresh.length).toBe(3);
    // Undo stellt die vorherige Auswahl wieder her
    await page.keyboard.press('Meta+z');
    const back = await page.evaluate(() => {
      const l = window.__bls.getProject()?.root.children[0];
      return l?.kind === 'layer' ? (l.selection?.clicks?.length ?? 0) / 3 : -1;
    });
    expect(back).toBe(3);
    console.log(
      `Smarte Auswahl: erster Klick ${firstMs} ms (Laden + Merkmale), weiterer Klick ${secondMs} ms`,
    );
  });
});
