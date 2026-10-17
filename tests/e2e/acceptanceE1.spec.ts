// Abnahme Phase E1 (Spec „Effekte“ Abschnitt 10): mindestens drei Effekte gleichzeitig auf unterschiedlichen, maskierten
// Ebenen; Export als PSD und PNG in voller Auflösung (24 MP). Misst Vorschau, Ausschnitt in voller Auflösung und Export.

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readPsd } from 'ag-psd';
import { PNG } from 'pngjs';
import { openFixture, waitForApp, waitForProject } from './helpers';

const W = 6000;
const H = 4000;

/** Fotoähnliches Testbild: Verläufe, Kreise, Streifen (Kanten für Linien-/Malerei-Effekte). */
function makeImage(path: string) {
  const img = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ring = Math.sin(Math.hypot(x - 2000, y - 1500) / 90) > 0.6 ? 70 : 0;
      const stripe = ((x + y) >> 6) & 1 ? 40 : 0;
      img.data[i] = Math.min(255, 40 + (x * 160) / W + ring);
      img.data[i + 1] = Math.min(255, 60 + (y * 140) / H + stripe);
      img.data[i + 2] = Math.min(255, 200 - (x * 120) / W + ring / 2);
      img.data[i + 3] = 255;
    }
  writeFileSync(path, PNG.sync.write(img, { deflateLevel: 1 }));
}

/** Maske A: Kreis in der Mitte; Maske B: linkes Drittel (weich). 16 Bit, in halber Auflösung. */
function masks(): { a: number[]; b: number[]; w: number; h: number } {
  const w = W / 2;
  const h = H / 2;
  const a: number[] = [];
  const b: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      a.push(Math.hypot(x - w / 2, y - h / 2) < 600 ? 65535 : 0);
      b.push(Math.round(65535 * Math.min(1, Math.max(0, (1100 - x) / 100))));
    }
  return { a, b, w, h };
}

async function download(page: Page, format: 'png' | 'psd'): Promise<{ path: string; ms: number }> {
  await page.getByTestId('export-button').click();
  await page.getByTestId(`export-${format}`).check();
  const t0 = Date.now();
  const dl = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByTestId('export-start').click();
  const path = await (await dl).path();
  return { path, ms: Date.now() - t0 };
}

test('Abnahme E1: drei maskierte Ebenen mit Effekten, PNG und PSD in voller Auflösung (24 MP)', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  await waitForApp(page);
  const file = testInfo.outputPath('abnahme-24mp.png');
  makeImage(file);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(file);
  await waitForProject(page);

  const m = masks();
  const layers = await page.evaluate(async (m) => {
    const b = window.__bls;
    const c = b.commands;
    const top = b.getProject()?.root.children[0];
    if (!top) throw new Error('keine Ebene');
    await b.ml.splitWithMask(top.id, Uint16Array.from(m.a), m.w, m.h);
    const g1 = b.getProject()?.root.children[0];
    if (g1?.kind !== 'group') throw new Error('keine Gruppe');
    const [, bg, fg] = g1.children;
    if (!bg || !fg) throw new Error('Ebenen fehlen');
    await b.ml.splitWithMask(bg.id, Uint16Array.from(m.b), m.w, m.h);
    const g1b = b.getProject()?.root.children[0];
    if (g1b?.kind !== 'group') throw new Error('keine Gruppe');
    const g2 = g1b.children[1];
    if (g2?.kind !== 'group') throw new Error('keine innere Gruppe');
    const [, rest, left] = g2.children;
    if (!rest || !left) throw new Error('Ebenen fehlen');
    const clear = (node: { id: string; effects: { instanceId: string }[] }) => {
      for (const fx of node.effects) c.removeEffectCommand(node.id, fx.instanceId);
    };
    const add = (id: string, effect: string, params: Record<string, unknown> = {}) => {
      const fx = c.addEffectCommand(effect, id);
      if (!fx) throw new Error(`${effect} fehlt`);
      for (const [k, v] of Object.entries(params)) c.setParamCommand(id, fx, k, v as never, false);
      return fx;
    };
    // Vordergrund (Maske A): Ölbild + Tusche-Linien (multiplizieren)
    clear(fg);
    add(fg.id, 'kuwahara', { radius: 12 });
    const ink = add(fg.id, 'ink-lines');
    c.setEffectBlendCommand(fg.id, ink, 'multiply');
    // linkes Drittel (Maske B): Halbton; Rest (¬B, Lochfüllung): Pixel + Körnung nur in hellen Bereichen
    clear(left);
    add(left.id, 'halftone-cmyk');
    clear(rest);
    add(rest.id, 'pixelate', { size: 24 });
    const grain = add(rest.id, 'film-grain', { amount: 60 });
    c.setEffectMaskCommand(rest.id, grain, {
      kind: 'map',
      map: 'luminance',
      from: 0.4,
      to: 1,
      feather: 0.1,
      invert: false,
    });
    // ganze Szene: Bloom auf der äußeren Gruppe
    add(g1b.id, 'bloom');
    return { fg: fg.id, left: left.id, rest: rest.id };
  }, m);
  expect(Object.keys(layers)).toHaveLength(3);

  // Vorschau: Neuberechnung nach Parameteränderung am Vordergrund (Ölbild), Median über 10 Läufe
  const preview = await page.evaluate(async (fgId) => {
    const b = window.__bls;
    const engine = b.getEngine();
    if (!engine) throw new Error('keine Engine');
    const s = b.store.getState();
    const c: [number, number, number] = [0.01, 0.01, 0.01];
    const colors = { background: c, checkerA: c, checkerB: c };
    const project0 = b.getProject();
    const find = (n: unknown): { id: string; effects: { instanceId: string; effectId: string }[] } | null => {
      const node = n as { id: string; effects: never[]; children?: unknown[] };
      if (node.id === fgId) return node;
      for (const ch of node.children ?? []) {
        const r = find(ch);
        if (r) return r;
      }
      return null;
    };
    const kuw = find(project0?.root)?.effects.find((e) => e.effectId === 'kuwahara');
    if (!kuw) throw new Error('Ölbild fehlt');
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      b.commands.setParamCommand(fgId, kuw.instanceId, 'radius', 6 + i, true);
      const t0 = performance.now();
      engine.present(b.getProject(), s.view, 2, colors, null);
      await engine.device.queue.onSubmittedWorkDone();
      times.push(performance.now() - t0);
    }
    b.commands.endGesture();
    times.sort((x, y) => x - y);
    return { median: times[5] ?? 0, max: times[9] ?? 0 };
  }, layers.fg);

  // Ausschnitt in voller Auflösung (100 %, Mitte des Bildes)
  const detailMs = await page.evaluate(async () => {
    const b = window.__bls;
    const engine = b.getEngine();
    if (!engine) throw new Error('keine Engine');
    b.store.getState().setView({ zoom: 1, offsetX: -2600, offsetY: -1700 });
    const t0 = performance.now();
    while (!engine.detailInfo()) {
      if (performance.now() - t0 > 60_000) throw new Error('kein Ausschnitt');
      await new Promise((r) => setTimeout(r, 10));
    }
    await engine.device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  });

  // PNG in voller Auflösung
  const png = await download(page, 'png');
  const out = PNG.sync.read(readFileSync(png.path));
  expect([out.width, out.height]).toEqual([W, H]);
  const src = PNG.sync.read(readFileSync(file));
  /** mittlere Abweichung zum Original in einem Feld */
  const diff = (x0: number, y0: number) => {
    let s = 0;
    for (let y = y0; y < y0 + 64; y++)
      for (let x = x0; x < x0 + 64; x++) {
        const i = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) s += Math.abs((out.data[i + k] ?? 0) - (src.data[i + k] ?? 0));
      }
    return s / (64 * 64 * 3);
  };
  // jede maskierte Ebene ist im Ergebnis sichtbar verändert
  expect(diff(3000, 2000)).toBeGreaterThan(3); // Vordergrund
  expect(diff(400, 2000)).toBeGreaterThan(3); // linkes Drittel
  expect(diff(5000, 600)).toBeGreaterThan(3); // Rest

  // PSD in voller Auflösung: Gruppenstruktur bleibt erhalten
  const psdFile = await download(page, 'psd');
  const psd = readPsd(readFileSync(psdFile.path), {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  });
  expect([psd.width, psd.height]).toEqual([W, H]);
  const names = (l: typeof psd.children) => (l ?? []).map((x) => x.name);
  const outer = psd.children?.find((x) => x.name === 'Motiv');
  expect(outer?.children?.some((x) => x.name === 'Motiv')).toBe(true); // innere Gruppe
  expect(names(outer?.children)).toContain('Vordergrund');

  const report = [
    `Abnahme E1, 24 MP (${W}×${H}), 3 maskierte Ebenen, 6 Effekte + Gruppeneffekt:`,
    `  Vorschau (2048 px) nach Parameteränderung: Median ${preview.median.toFixed(0)} ms, max ${preview.max.toFixed(0)} ms`,
    `  Ausschnitt in voller Auflösung (inkl. 150 ms Ruhepause): ${detailMs.toFixed(0)} ms`,
    `  PNG-Export: ${(png.ms / 1000).toFixed(1)} s, PSD-Export: ${(psdFile.ms / 1000).toFixed(1)} s`,
  ].join('\n');
  console.log(report);
  await testInfo.attach('messwerte.txt', { body: report });
});

test('Abnahme E1: Vorschauzeit je GPU-Effekt bei 1600 px (Echtzeit ≥ 30 fps)', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await waitForApp(page);
  await openFixture(page, 'photo-portrait-street.jpg');
  const rows = await page.evaluate(async () => {
    const b = window.__bls;
    const engine = b.getEngine();
    const layer = b.getProject()?.root.children[0];
    if (!engine || !layer) throw new Error('kein Projekt');
    const s = b.store.getState();
    const c: [number, number, number] = [0.01, 0.01, 0.01];
    const colors = { background: c, checkerA: c, checkerB: c };
    const out: { id: string; cost: string; median: number }[] = [];
    const plugins = Object.values(b.plugins.getState().plugins).filter(
      (p) =>
        p.status === 'ok' &&
        p.manifest?.implementations.preview === 'webgpu' &&
        !p.folder.startsWith('zz-') &&
        p.folder !== 'shadow',
    );
    for (const p of plugins) {
      const fx = b.commands.addEffectCommand(p.folder, layer.id);
      if (!fx) continue;
      const times: number[] = [];
      for (let i = 0; i < 9; i++) {
        engine.resetPreview(); // alles neu rechnen (ganzer Frame inkl. Import-Ausschnitt)
        const t0 = performance.now();
        engine.present(b.getProject(), s.view, 2, colors, null);
        await engine.device.queue.onSubmittedWorkDone();
        if (i > 0) times.push(performance.now() - t0);
      }
      b.commands.removeEffectCommand(layer.id, fx);
      times.sort((x, y) => x - y);
      out.push({ id: p.folder, cost: p.manifest?.cost ?? '', median: times[4] ?? 0 });
    }
    // Grundlast ohne Effekt
    const base: number[] = [];
    for (let i = 0; i < 8; i++) {
      engine.resetPreview();
      const t0 = performance.now();
      engine.present(b.getProject(), s.view, 2, colors, null);
      await engine.device.queue.onSubmittedWorkDone();
      base.push(performance.now() - t0);
    }
    base.sort((x, y) => x - y);
    out.push({ id: '(ohne Effekt)', cost: '', median: base[4] ?? 0 });
    return out;
  });
  const report = rows
    .map((r) => `  ${r.id.padEnd(20)} ${r.cost.padEnd(12)} ${r.median.toFixed(1).padStart(6)} ms`)
    .join('\n');
  console.log(`Vorschau 1600 × 1067, ganzer Frame neu (Median):\n${report}`);
  await testInfo.attach('vorschau-1600.txt', { body: report });
  for (const r of rows) if (r.cost === 'realtime') expect(r.median, r.id).toBeLessThan(33);
});
