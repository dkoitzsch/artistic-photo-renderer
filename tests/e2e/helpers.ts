import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

export const fixture = (name: string): string => new URL(`../fixtures/${name}`, import.meta.url).pathname;

export async function waitForApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.statusbar-gpu')).toContainText('WebGPU ·');
  // Plugins kompiliert?
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.values(window.__bls.plugins.getState().plugins).every((p) => p.status !== 'pending'),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

export async function openFixture(page: Page, name = 'synthetic-400x300.png'): Promise<void> {
  if (await page.getByTestId('project-overview').count()) await page.getByText('Zur Arbeitsfläche').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-button').click();
  await (await chooser).setFiles(fixture(name));
  await waitForProject(page);
}

export async function waitForProject(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            ((window as Partial<Window>).__bls?.getProject() ?? null) !== null &&
            window.__bls.store.getState().busy === null,
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
}

/** Wartet, bis die Vorschau gezeichnet und die GPU fertig ist. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const engine = window.__bls.getEngine();
            if (!engine) {
              resolve();
              return;
            }
            void engine.device.queue.onSubmittedWorkDone().then(() => {
              resolve();
            });
          });
        });
      }),
  );
}

/** Pixel (sRGB 8 Bit) der Leinwand an einer Stelle relativ zur Leinwand (0..1). */
export async function canvasPixel(page: Page, fx = 0.5, fy = 0.5): Promise<[number, number, number]> {
  await settle(page);
  const shot = PNG.sync.read(await page.getByTestId('canvas').screenshot());
  const x = Math.floor(shot.width * fx);
  const y = Math.floor(shot.height * fy);
  const i = (y * shot.width + x) * 4;
  return [shot.data[i] ?? -1, shot.data[i + 1] ?? -1, shot.data[i + 2] ?? -1];
}

export function expectColor(got: number[], want: number[], tol = 2): void {
  const diff = Math.max(...got.map((v, i) => Math.abs(v - (want[i] ?? 0))));
  expect(diff, `Farbe ${got.join(',')} statt ${want.join(',')}`).toBeLessThanOrEqual(tol);
}

/** Rendert das aktuelle Projekt wie der Export (volle Auflösung, gekachelt) und liefert das PNG. */
export async function renderExport(page: Page, tileSize?: number): Promise<PNG> {
  const b64 = await page.evaluate(async (tile) => {
    const bls = window.__bls;
    const prev = bls.exportSettings.tileSize;
    if (tile) bls.exportSettings.tileSize = tile;
    try {
      const project = bls.getProject();
      if (!project) throw new Error('kein Projekt');
      const blob = await bls.renderPng(project);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    } finally {
      bls.exportSettings.tileSize = prev;
    }
  }, tileSize);
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

/** Fügt per Befehl einen Effekt zur ersten Ebene hinzu und setzt Parameter; liefert IDs. */
export async function addEffect(
  page: Page,
  effectId: string,
  params: Record<string, unknown> = {},
): Promise<{ layerId: string; instanceId: string }> {
  return page.evaluate(
    ({ effectId, params }) => {
      const bls = window.__bls;
      const project = bls.getProject();
      const layer = project?.root.children[0];
      if (!layer) throw new Error('keine Ebene');
      const instanceId = bls.commands.addEffectCommand(effectId, layer.id);
      if (!instanceId) throw new Error(`Effekt ${effectId} nicht verfügbar`);
      for (const [k, v] of Object.entries(params))
        bls.commands.setParamCommand(layer.id, instanceId, k, v as never, false);
      return { layerId: layer.id, instanceId };
    },
    { effectId, params },
  );
}

export function diffStats(a: PNG, b: PNG): { max: number; mean: number } {
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
      max = Math.max(max, d);
      sum += d;
      n++;
    }
  }
  return { max, mean: sum / n };
}
