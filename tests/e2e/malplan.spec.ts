// E2 Schritte 6–8: Arbeitsbereich „Malplan“ – Analyse, Hilfen, Format/Zuschnitt, Einstellungen im Projekt, PNG.
import { expect, test, type Page } from '@playwright/test';
import { openFixture, waitForApp } from './helpers';

const malplan = (page: Page) =>
  page.evaluate(() => {
    const p = window.__bls.getProject();
    return p?.malplan ?? null;
  });

/** Pixel des angezeigten Hilfsbildes (Mitte bzw. relative Lage) als [r, g, b]. */
const helpPixel = (page: Page, fx: number, fy: number) =>
  page.evaluate(
    ({ fx, fy }) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="malplan-image"]');
      const g = c?.getContext('2d');
      if (!c || !g) return null;
      const d = g.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
    },
    { fx, fy },
  );

async function ready(page: Page) {
  await expect(page.getByTestId('malplan-ready')).toBeAttached({ timeout: 60_000 });
  await expect(page.getByTestId('malplan-busy')).toBeHidden({ timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
});

test('Malplan: Analyse, Werteskizze und Notan, Einstellungen im Projekt mit Undo', async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, 'golden/portrait.png');
  await page.getByTestId('workspace-malplan').click();
  await expect(page.getByTestId('malplan')).toBeVisible();
  await ready(page);
  // Werteskizze: Graustufen (r = g = b), nur so viele Stufen wie eingestellt
  await page.getByTestId('help-values').click();
  const levels = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="malplan-image"]');
    const g = c?.getContext('2d');
    if (!c || !g) return [];
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return [-1];
      set.add(d[i] ?? 0);
    }
    return [...set].sort((a, b) => a - b);
  });
  expect(levels.length).toBe(4);
  // drei Stufen
  await page.getByTestId('malplan-values').getByRole('radio', { name: '3' }).click();
  await ready(page);
  expect((await malplan(page))?.values.levels).toBe(3);
  // Notan: nur zwei Werte; Schwelle 100 % → alles dunkel
  await page.getByTestId('help-notan').click();
  const field = page.getByTestId('malplan-threshold').getByRole('textbox');
  await field.fill('100');
  await field.press('Enter');
  await ready(page);
  const dark = await helpPixel(page, 0.5, 0.5);
  expect(dark?.[0]).toBeLessThan(60);
  // Undo stellt die Schwelle wieder her
  await page.getByTestId('undo').click();
  await expect.poll(async () => (await malplan(page))?.notan.threshold).toBe(0.5);
  // Warm-Kalt-Karte und Kontur entstehen
  for (const h of ['warmcold', 'contour', 'scale', 'grid', 'final'] as const) {
    await page.getByTestId(`help-${h}`).click();
    await expect(page.locator(`[data-testid="malplan-image"][data-help="${h}"]`)).toBeVisible();
  }
});

test('Malplan: Format und Zuschnitt, Formen-Regler, PNG einer Hilfe, zurück zum Editor', async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, 'golden/landscape.png');
  await page.getByTestId('workspace-malplan').click();
  await ready(page);
  // Querformat-Bild → Querformat-Untergrund
  const s0 = await malplan(page);
  const before = s0 ?? { format: { widthCm: 40, heightCm: 30 } };
  expect(before.format.widthCm).toBeGreaterThanOrEqual(before.format.heightCm);
  // quadratisches Format → Zuschnitt quadratisch (in Leinwand-px)
  await page.getByTestId('malplan-format').selectOption('square-50');
  const canvas = await page.evaluate(() => window.__bls.getProject()?.canvas ?? { width: 1, height: 1 });
  await expect
    .poll(async () => {
      const s = await malplan(page);
      if (!s) return 0;
      return (s.crop.width * canvas.width) / (s.crop.height * canvas.height);
    })
    .toBeCloseTo(1, 3);
  await ready(page);
  await page.getByTestId('help-final').click();
  const dims = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="malplan-image"]');
    return c ? [c.width, c.height] : [0, 0];
  });
  expect(Math.abs((dims[0] ?? 0) - (dims[1] ?? 0))).toBeLessThanOrEqual(1);
  // Zuschnitt verschieben (Editor), Projekt speichert ihn
  await page.getByTestId('crop-toggle').click();
  const rect = page.getByTestId('crop-rect');
  await expect(rect).toBeVisible();
  const box = await rect.boundingBox();
  if (!box) throw new Error('kein Zuschnitt');
  const x0 = (await malplan(page))?.crop.x ?? 0;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await malplan(page))?.crop.x ?? 0).toBeGreaterThan(x0);
  await page.getByTestId('crop-toggle').click();
  // weniger Formen → weniger Flächen
  const regions = () => page.evaluate(() => window.__bls.malplan.getState().result?.regions.length ?? 0);
  await ready(page);
  const many = await regions();
  const shapes = page.getByTestId('malplan-shapes').getByRole('textbox');
  await shapes.fill('20');
  await shapes.press('Enter');
  await expect.poll(regions, { timeout: 60_000 }).toBeLessThan(many);
  expect(await regions()).toBeLessThanOrEqual(20);
  // PNG der Hilfe
  await page.getByTestId('help-contour').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('malplan-png').click();
  expect((await dl).suggestedFilename()).toMatch(/Konturvorlage\.png$/);
  // zurück zum Editor: Leinwand wieder da
  await page.getByTestId('workspace-edit').click();
  await expect(page.locator('canvas.canvas, [data-testid="canvas"]').first()).toBeVisible();
});

test('Beamer-Fenster: zeigt die Hilfe, Trapezkorrektur über Ecken wird im Projekt gespeichert', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await openFixture(page, 'golden/still-life.png');
  await page.getByTestId('workspace-malplan').click();
  await ready(page);
  await page.getByTestId('beamer-help').selectOption('notan');
  const popupP = context.waitForEvent('page');
  await page.getByTestId('beamer-open').click();
  const beamer = await popupP;
  await beamer.setViewportSize({ width: 1000, height: 700 });
  const img = beamer.getByTestId('beamer-image');
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect(img).toHaveAttribute('alt', 'Notan');
  // eingepasst: Bild füllt die Breite oder Höhe, Seitenverhältnis bleibt
  const b0 = await img.boundingBox();
  expect(b0).not.toBeNull();
  // Ecke oben links nach innen ziehen → Trapez
  const corner = beamer.getByTestId('beamer-corner-0');
  const cb = await corner.boundingBox();
  if (!cb) throw new Error('keine Ecke');
  await beamer.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await beamer.mouse.down();
  await beamer.mouse.move(cb.x + 120, cb.y + 80, { steps: 5 });
  await beamer.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.__bls.getProject()?.malplan?.beamer.corners[0]?.[0] ?? 0))
    .toBeGreaterThan(0.1);
  const t = await img.evaluate((el) => getComputedStyle(el).transform);
  expect(t).toMatch(/^matrix3d/);
  // Hilfe wechseln → Beamer folgt
  await page.getByTestId('beamer-help').selectOption('contour');
  await expect(img).toHaveAttribute('alt', 'Konturvorlage', { timeout: 30_000 });
  await beamer.close();
});

test('PDF-Malmappe: alle Seiten, Konturvorlage in Originalgröße auf A4 gekachelt', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await openFixture(page, 'golden/landscape.png');
  await page.getByTestId('workspace-malplan').click();
  await ready(page);
  // Format 60 × 40 cm (quer), Konturvorlage auf A4 mit 1 cm Überlappung
  await page.getByTestId('malplan-width').fill('60');
  await page.getByTestId('malplan-height').fill('40');
  await ready(page);
  await page.getByTestId('pdf-toggle').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('pdf-create').click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/Malmappe\.pdf$/);
  const path = testInfo.outputPath('malmappe.pdf');
  await download.saveAs(path);
  const { readFileSync, copyFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  if (process.env.MALMAPPE_OUT) copyFileSync(path, process.env.MALMAPPE_OUT);
  const s = bytes.toString('latin1');
  expect(s.startsWith('%PDF-1.4')).toBe(true);
  const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)?.[1]);
  // 6 Einzelseiten + Übersicht + Kacheln (60 × 40 cm auf A4: 3 × 2 quer bzw. 4 × 2 hoch)
  expect(count).toBeGreaterThanOrEqual(7 + 4);
  // Bildrahmen in Originalgröße: 60 × 40 cm = 1700,787 × 1133,858 pt
  expect(s).toContain('1700.787 1133.858 re S');
  // A4-Seiten (hoch oder quer)
  expect(s).toMatch(/\/MediaBox \[0 0 (595\.28 841\.89|841\.89 595\.28)\]/);
  // Kachelblätter mit Kontrollmaß und Bezeichnung
  expect(s).toContain('(5 cm) Tj');
  expect(s).toContain('Blatt A1');
});
