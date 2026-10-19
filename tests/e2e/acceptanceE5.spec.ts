// Abnahme Phase E5 (Spec „Effekte“ Abschnitt 10): Jeder Simulationseffekt liefert mit Standard-Presets auf den
// Testbildern ein überzeugendes Ergebnis (Golden-Tests in effectCases.ts, je zwei Fälle); Endrender in 24 MP läuft
// stabil durch. Hier: alle Simulationseffekte nacheinander auf einem 24-MP-Bild, Vorschau und PNG in voller Auflösung,
// Messwerte und Verkleinerungen der Ergebnisse als Anhang.

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { waitForApp, waitForProject } from './helpers';

const W = 6000;
const H = 4000;

const SIMULATIONS = [
  'reaction-diffusion',
  'crystal-growth',
  'erosion',
  'chemical',
  'aging',
  'memory',
  'cubist',
  'watercolor-sim',
];

/** Fotoähnliches Testbild: Himmel, Hügel, heller Kreis (Motiv), dunkle Streifen (Kanten). */
function makeImage(path: string) {
  const img = new PNG({ width: W, height: H });
  const hill = 2300;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const horizon = hill + 260 * Math.sin(x / 700) + 120 * Math.sin(x / 190);
      const sky = y < horizon;
      const disc = Math.hypot(x - 2700, y - 1900) < 900;
      const stripe = !sky && ((x >> 7) & 3) === 0 ? 0.55 : 1;
      let r = sky ? 120 + (y * 80) / H : 70 + (x * 60) / W;
      let g = sky ? 160 + (y * 50) / H : 110 - (y * 30) / H;
      let b = sky ? 230 - (y * 40) / H : 50;
      if (disc) {
        r = 225;
        g = 180;
        b = 150 - Math.hypot(x - 2700, y - 1900) / 20;
      }
      img.data[i] = Math.min(255, r * stripe);
      img.data[i + 1] = Math.min(255, g * stripe);
      img.data[i + 2] = Math.min(255, b * stripe);
      img.data[i + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(img, { deflateLevel: 1 }));
}

test('Abnahme E5: alle Simulationseffekte in 24 MP (Vorschau und Endrender)', async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  await waitForApp(page);
  const file = testInfo.outputPath('abnahme-e5-24mp.png');
  makeImage(file);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(file);
  await waitForProject(page);
  for (const id of SIMULATIONS)
    await expect
      .poll(() => page.evaluate((id) => window.__bls.plugins.getState().plugins[id]?.status ?? 'fehlt', id), {
        timeout: 15_000,
      })
      .toBe('ok');

  // Tiefe (Kubismus, Erosion), Auffälligkeit und Gesichter (Erinnerung) synthetisch – ohne Modelle
  await page.evaluate(async () => {
    const p = window.__bls.getProject();
    const o = p ? Object.values(p.originals)[0] : undefined;
    if (!o) throw new Error('kein Original');
    const w = 192;
    const h = 128;
    const d = new Float32Array(w * h);
    const s = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x / w - 0.45, (y / h - 0.475) * 0.67);
        const disc = Math.min(1, Math.max(0, (0.15 - r) / 0.04));
        d[y * w + x] = disc * 0.1 + (1 - disc) * (0.25 + 0.7 * (1 - y / h));
        s[y * w + x] = disc;
      }
    await window.__bls.ml.injectMap(o.id, 'depth', d, w, h);
    await window.__bls.ml.injectMap(o.id, 'saliency', s, w, h);
    await window.__bls.ml.injectMap(o.id, 'faces', new Float32Array(w * h), w, h);
  });

  const rows: string[] = [];
  for (const effectId of SIMULATIONS) {
    const r = await page.evaluate(async (effectId) => {
      const b = window.__bls;
      const engine = b.getEngine();
      const layer = b.getProject()?.root.children[0];
      if (!engine || layer?.kind !== 'layer') throw new Error('keine Ebene');
      for (const fx of layer.effects) b.commands.removeEffectCommand(layer.id, fx.instanceId);
      if (!b.commands.addEffectCommand(effectId, layer.id)) throw new Error(`${effectId} fehlt`);
      const project = b.getProject();
      if (!project) throw new Error('kein Projekt');
      // Vorschau (≤ 2048 px): erste vollständige Berechnung (Simulation inklusive)
      const t0 = performance.now();
      await engine
        .renderResolved(project, {
          scale: 2048 / 6000,
          canvasSize: [project.canvas.width, project.canvas.height],
          region: { x: 0, y: 0, width: project.canvas.width, height: project.canvas.height },
          ignoreEffects: false,
          cache: null,
          variant: 'e5-preview',
          final: false,
        })
        .then((res) => {
          if (res.owned) engine.core.pool.release(res.tex);
        });
      await engine.device.queue.onSubmittedWorkDone();
      const previewMs = performance.now() - t0;
      // Endrender in voller Auflösung als PNG
      const t1 = performance.now();
      const blob = await b.renderPng(project);
      const exportMs = performance.now() - t1;
      const bmp = await createImageBitmap(blob);
      const full = [bmp.width, bmp.height];
      // Verkleinerung (Anhang) und Prüfwerte: Abweichung vom Original, Streuung (kein leeres Bild)
      const tw = 600;
      const th = 400;
      const c = new OffscreenCanvas(tw, th);
      const g = c.getContext('2d');
      if (!g) throw new Error('kein 2D-Kontext');
      g.drawImage(bmp, 0, 0, tw, th);
      const out = g.getImageData(0, 0, tw, th).data;
      bmp.close();
      const thumb = await c.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await thumb.arrayBuffer());
      let bin = '';
      for (const v of bytes) bin += String.fromCharCode(v);
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < out.length; i += 4) {
        const l = ((out[i] ?? 0) + (out[i + 1] ?? 0) + (out[i + 2] ?? 0)) / 3;
        sum += l;
        sq += l * l;
      }
      const n = out.length / 4;
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      return { previewMs, exportMs, full, mean, sd, thumb: btoa(bin) };
    }, effectId);
    expect(r.full, effectId).toEqual([W, H]);
    // kein leeres oder einfarbiges Ergebnis
    expect(r.sd, effectId).toBeGreaterThan(8);
    expect(r.mean, effectId).toBeGreaterThan(15);
    expect(r.mean, effectId).toBeLessThan(245);
    const thumbPath = testInfo.outputPath(`${effectId}.png`);
    writeFileSync(thumbPath, Buffer.from(r.thumb, 'base64'));
    await testInfo.attach(`${effectId}.png`, { path: thumbPath, contentType: 'image/png' });
    rows.push(
      `  ${effectId.padEnd(20)} Vorschau ${(r.previewMs / 1000).toFixed(1).padStart(5)} s, ` +
        `Endrender 24 MP (PNG) ${(r.exportMs / 1000).toFixed(1).padStart(5)} s`,
    );
  }
  const report = [`Abnahme E5, 24 MP (${W}×${H}), Standardwerte je Simulationseffekt:`, ...rows].join('\n');
  console.log(report);
  await testInfo.attach('messwerte.txt', { body: report });
});
