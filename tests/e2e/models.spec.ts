// Modell-Übersicht: Status, Fortschritt, Pausieren/Fortsetzen (über Neuladen hinweg), Stoppen, Löschen.

import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { waitForApp } from './helpers';

const CACHE = new URL('../.cache/models/', import.meta.url).pathname;
test.skip(
  !existsSync(`${CACHE}birefnet-lite-512-fp16.onnx`),
  'Modelle fehlen – zuerst „npm run models:fetch“',
);

const row = (page: Page, id: string) => page.getByTestId(`model-${id}`);

async function throttle(page: Page, bytesPerSecond: number | null) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: bytesPerSecond ?? -1,
    uploadThroughput: -1,
  });
}

test('Modelle: Status sehen, pausieren, nach Neuladen fortsetzen, löschen und stoppen', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    localStorage.setItem('bls.modelMirror', '/__models/');
    localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
  });
  await waitForApp(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('open-models').click();
  const dialog = page.getByTestId('models-dialog');
  await expect(dialog).toBeVisible();

  // Ausgangslage: nichts heruntergeladen; NC-Modell im Modus „Kommerziell“ gesperrt
  const bn = row(page, 'birefnet-lite');
  await expect(bn).toHaveAttribute('data-status', 'missing');
  await expect(row(page, 'rmbg-1.4').getByTestId('model-start')).toBeDisabled();
  await expect(row(page, 'birefnet')).toContainText('Dienst nicht verbunden');

  // Herunterladen (gedrosselt) und pausieren
  await throttle(page, 8 * 1024 * 1024);
  await bn.getByTestId('model-start').click();
  await expect(bn).toHaveAttribute('data-status', 'downloading');
  await expect(page.getByTestId('download-chip')).toContainText('Modelle laden');
  await expect(bn).toContainText(/MB von 98.5 MB \(\d+ %\)/);
  await page.waitForTimeout(800);
  await bn.getByTestId('model-pause').click();
  await expect(bn).toHaveAttribute('data-status', 'paused');
  const pausedText = (await bn.textContent()) ?? '';
  const pausedMb = Number(/pausiert ([\d.]+) MB/.exec(pausedText)?.[1] ?? '0');
  expect(pausedMb).toBeGreaterThan(0);
  await expect(page.getByTestId('download-chip')).toContainText('pausiert');

  // Neuladen: Teil-Download bleibt erhalten, Fortsetzen lädt den Rest
  await page.reload();
  await waitForApp(page);
  await page.getByTestId('download-chip').click();
  await expect(bn).toHaveAttribute('data-status', 'paused');
  await throttle(page, null);
  await bn.getByTestId('model-resume').click();
  await expect(bn).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await expect(bn).toContainText('heruntergeladen');
  await expect(page.getByTestId('download-chip')).toHaveCount(0);

  // Löschen
  page.once('dialog', (d) => void d.accept());
  await bn.getByTestId('model-delete').click();
  await expect(bn).toHaveAttribute('data-status', 'missing');

  // Stoppen verwirft den Teil-Download
  await throttle(page, 8 * 1024 * 1024);
  await bn.getByTestId('model-start').click();
  await expect(bn).toHaveAttribute('data-status', 'downloading');
  await page.waitForTimeout(400);
  await bn.getByTestId('model-stop').click();
  await expect(bn).toHaveAttribute('data-status', 'missing');
  await expect(bn).not.toContainText('MB von');
});
