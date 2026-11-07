// Phase 6: Inpainting-Lochfüllung mit LaMa im (Test-)Dienst. Das echte Modell kommt aus dem Test-Cache
// (npm run models:fetch) in den Cache des Test-Dienstes – wie nach einem Download im Dialog „Modelle“.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { diffStats, openFixture, renderExport, waitForApp } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
const REVISION = 'c3c0c9e468934d62e79c329e35d82dd09ff8c444';

test.describe('Lochfüllung mit LaMa', () => {
  test.skip(!existsSync(`${CACHE}lama_fp32.onnx`), 'LaMa fehlt im Test-Cache (npm run models:fetch)');

  test('Hintergrund-Loch wird mit LaMa gefüllt; Rest unverändert; Rückgängig; Speichern', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const dir = join(tmpdir(), 'bls-e2e-service-cache', 'models', 'lama');
    mkdirSync(dir, { recursive: true });
    copyFileSync(`${CACHE}lama_fp32.onnx`, join(dir, 'lama_fp32.onnx'));
    writeFileSync(join(dir, '.complete'), REVISION);
    await page.addInitScript((url) => {
      localStorage.setItem('bls.serviceUrl', url);
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'service' }));
    }, TEST_SERVICE_URL);
    await waitForApp(page);
    await openFixture(page, 'golden/portrait.png');

    // Vordergrund = Ellipse in der Mitte (Maske in halber Auflösung); der Hintergrund hat ein Loch dort
    const bgId = await page.evaluate(async () => {
      const b = window.__bls;
      const top = b.getProject()?.root.children[0];
      if (!top) throw new Error('keine Ebene');
      const w = 192;
      const h = 128;
      const m = new Uint16Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) m[y * w + x] = Math.hypot((x - 90) / 40, (y - 62) / 52) < 1 ? 65535 : 0;
      await b.ml.splitWithMask(top.id, m, w, h);
      const g = b.getProject()?.root.children[0];
      if (g?.kind !== 'group') throw new Error('keine Gruppe');
      const bg = g.children[1];
      if (!bg || bg.kind !== 'layer') throw new Error('kein Hintergrund');
      return bg.id;
    });
    // Vordergrund ausblenden: sichtbar bleibt der gefüllte Hintergrund
    await page.evaluate(() => {
      const g = window.__bls.getProject()?.root.children[0];
      const fg = g?.kind === 'group' ? g.children[2] : undefined;
      if (fg) window.__bls.commands.setNodeVisibleCommand(fg.id, false);
    });

    await expect
      .poll(() => page.evaluate(() => window.__bls.ml.inpaintAvailability()), { timeout: 60_000 })
      .toEqual({ ok: true });
    const before = await renderExport(page);
    const ok = await page.evaluate((id) => window.__bls.ml.inpaintLayer(id), bgId);
    expect(ok).toBe(true);
    const state = await page.evaluate((id) => {
      const p = window.__bls.getProject();
      const find = (
        n: unknown,
      ): { inpaint?: { originalId: string; provenance: { modelId: string } } } | null => {
        const x = n as {
          id: string;
          children?: unknown[];
          inpaint?: { originalId: string; provenance: { modelId: string } };
        };
        if (x.id === id) return x;
        for (const c of x.children ?? []) {
          const r = find(c);
          if (r) return r;
        }
        return null;
      };
      const l = find(p?.root);
      return { inpaint: l?.inpaint ?? null, originals: Object.keys(p?.originals ?? {}).length };
    }, bgId);
    expect(state.inpaint?.provenance.modelId).toBe('lama');
    expect(state.originals).toBe(2);

    const after = await renderExport(page);
    const debugDir = process.env.BLS_DEBUG_DIR;
    if (debugDir) {
      writeFileSync(join(debugDir, 'inpaint-vorher.png'), PNG.sync.write(before));
      writeFileSync(join(debugDir, 'inpaint-nachher.png'), PNG.sync.write(after));
    }
    expect(after.width).toBe(before.width);
    const stats = (x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * before.width + x) * 4;
          for (let k = 0; k < 3; k++) sum += Math.abs((after.data[i + k] ?? 0) - (before.data[i + k] ?? 0));
          n += 3;
        }
      return sum / n;
    };
    // im Loch (Ellipse bei x = 180, y = 124; Halbachsen 80 × 104) unterscheidet sich die Füllung deutlich
    expect(stats(150, 100, 210, 150)).toBeGreaterThan(2);
    // weit außerhalb des Lochs bleibt alles gleich
    expect(stats(0, 0, 60, 60)).toBeLessThan(0.5);
    expect(stats(before.width - 60, before.height - 60, before.width, before.height)).toBeLessThan(0.5);
    // Kachelgleich (Export in Kacheln = am Stück)
    expect(diffStats(after, await renderExport(page, 64)).max).toBeLessThanOrEqual(1);

    // Rückgängig: wieder die schnelle Füllung
    await page.getByTestId('undo').click();
    const undone = await renderExport(page);
    expect(diffStats(before, undone).max).toBeLessThanOrEqual(1);
  });
});
