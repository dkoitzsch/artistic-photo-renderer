import { expect, test } from '@playwright/test';

test('ohne WebGPU erscheint eine verständliche Meldung', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
  await page.goto('/');
  const alert = page.getByTestId('gpu-unavailable');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('WebGPU ist nicht verfügbar');
  await expect(alert).toContainText('chrome://gpu');
  await expect(page.getByTestId('open-button')).toHaveCount(0);
});
