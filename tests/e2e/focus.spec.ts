// Fokuspunkte entfernen; Vorher/Nachher-Teiler bleibt greifbar, auch wenn ein Fokuspunkt darunter liegt.

import { expect, test, type Page } from '@playwright/test';
import { openFixture, waitForApp } from './helpers';

const points = (page: Page) =>
  page.evaluate(() => {
    const p = window.__bls.getProject();
    const l = p?.root.children[0];
    return l?.kind === 'layer' ? (l.focusMap?.points ?? []).map((x) => ({ id: x.id, x: x.x, y: x.y })) : [];
  });

/** Bildschirmposition (Seite) eines Leinwandpunkts */
async function screenPos(page: Page, x: number, y: number) {
  const box = await page.getByTestId('canvas').boundingBox();
  const view = await page.evaluate(() => window.__bls.store.getState().view);
  if (!box) throw new Error('keine Leinwand');
  return { x: box.x + x * view.zoom + view.offsetX, y: box.y + y * view.zoom + view.offsetY };
}

test.beforeEach(async ({ page }) => {
  await waitForApp(page);
  await openFixture(page);
  await page.getByTestId('tool-focus').click();
});

test('Fokuspunkte setzen und entfernen: × am Punkt, Entf-Taste und im Inspektor', async ({ page }) => {
  // drei Punkte per Klick setzen
  for (const [x, y] of [
    [100, 100],
    [300, 100],
    [200, 220],
  ] as const) {
    const s = await screenPos(page, x, y);
    await page.mouse.click(s.x, s.y);
  }
  expect(await points(page)).toHaveLength(3);
  await expect(page.getByTestId('focus-section').locator('.focus-item')).toHaveCount(3);

  // × am ersten Punkt
  await page.getByTestId('focus-remove').first().click();
  expect(await points(page)).toHaveLength(2);

  // Punkt anfassen und Entf
  const [p2] = await points(page);
  if (!p2) throw new Error();
  const s2 = await screenPos(page, p2.x, p2.y);
  await page.mouse.move(s2.x, s2.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press('Delete');
  expect(await points(page)).toHaveLength(1);

  // im Inspektor
  await page
    .getByTestId('focus-section')
    .getByRole('button', { name: /^Punkt \d+ entfernen$/ })
    .click();
  expect(await points(page)).toHaveLength(0);

  // Undo holt den letzten zurück
  await page.keyboard.press('Meta+z');
  expect(await points(page)).toHaveLength(1);
});

test('Vorher/Nachher: Teiler ist greifbar, auch über einem Fokuspunkt', async ({ page }) => {
  // Punkt genau in die Bildmitte – dort liegt der Teiler nach dem Einschalten
  const center = await page.evaluate(() => {
    const p = window.__bls.getProject();
    return p ? { x: p.canvas.width / 2, y: p.canvas.height / 2 } : { x: 0, y: 0 };
  });
  const s = await screenPos(page, center.x, center.y);
  await page.mouse.click(s.x, s.y);
  const before = await points(page);
  expect(before).toHaveLength(1);

  await page.keyboard.press('\\');
  const handle = page.getByTestId('compare-handle');
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  if (!hb) throw new Error();
  // am Griff über dem Punkt ziehen
  const grabX = hb.x + hb.width / 2;
  const grabY = s.y;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX - 120, grabY, { steps: 6 });
  await page.mouse.up();

  const split = await page.evaluate(() => window.__bls.store.getState().compareSplit);
  expect(split).not.toBeNull();
  expect(split ?? 1).toBeLessThan(0.45);
  // Fokuspunkt unverändert, kein neuer Punkt
  expect(await points(page)).toEqual(before);
  // × ist im Vergleichsmodus nicht vorhanden
  await expect(page.getByTestId('focus-remove')).toHaveCount(0);
});

test('Dialoge liegen über Fokuspunkten: Effekt-Browser bleibt mit aktivem Fokus-Werkzeug bedienbar', async ({
  page,
}) => {
  // Punkte rund um die Bildmitte – dort öffnet sich der Effekt-Browser
  const size = await page.evaluate(() => {
    const p = window.__bls.getProject();
    return p ? { w: p.canvas.width, h: p.canvas.height } : { w: 0, h: 0 };
  });
  for (const [fx, fy] of [
    [0.3, 0.4],
    [0.5, 0.5],
    [0.7, 0.6],
  ] as const) {
    const s = await screenPos(page, size.w * fx, size.h * fy);
    await page.mouse.click(s.x, s.y);
  }
  expect(await points(page)).toHaveLength(3);
  await expect(page.getByTestId('tool-focus')).toHaveClass(/active/);

  // „+ Effekt“ mit weiterhin aktivem Fokus-Werkzeug
  await page.getByTestId('add-effect').click();
  const browser = page.getByTestId('effect-browser');
  await expect(browser).toBeVisible();
  const tile = page.getByTestId('effect-tile-gaussian-blur');
  const box = await tile.boundingBox();
  if (!box) throw new Error('keine Kachel');
  // Oberstes Element an der Kachel ist die Kachel selbst, kein Fokuspunkt
  const topIsTile = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[data-testid="effect-tile-gaussian-blur"]') !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(topIsTile).toBe(true);
  // Kein Fokuspunkt ragt über den Dialog
  const pointsAbove = await page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="effect-browser"]')?.getBoundingClientRect();
    if (!dlg) return -1;
    let n = 0;
    for (let y = dlg.top + 5; y < dlg.bottom; y += 20)
      for (let x = dlg.left + 5; x < dlg.right; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el?.closest('[data-testid="focus-overlay"]')) n++;
      }
    return n;
  });
  expect(pointsAbove).toBe(0);

  await tile.click();
  await expect(browser).toHaveCount(0);
  await expect(page.getByTestId('effect-card-gaussian-blur')).toBeVisible();
  // Klick auf die Kachel hat keinen Fokuspunkt erzeugt
  expect(await points(page)).toHaveLength(3);
});
