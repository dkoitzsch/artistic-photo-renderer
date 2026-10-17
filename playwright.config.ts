import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/** Adresse des ML-Dienstes in den Tests (eigener Port, damit ein laufender Dev-Dienst nicht stört) */
export const TEST_SERVICE_URL = 'http://127.0.0.1:8766';

// WebGPU braucht echtes Chrome (Kanal "chrome"), nicht das gebündelte Chromium.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5317',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--force-color-profile=srgb'],
    },
  },
  webServer: [
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5317',
      reuseExistingServer: true,
    },
    {
      // ML-Dienst für Tests auf eigenem Port (8766), mit Test-Effekten, ohne Modell-Downloads, eigener Cache
      command: 'uv run --project ml-service ml-service',
      url: `${TEST_SERVICE_URL}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        BLS_PORT: '8766',
        BLS_TEST_EFFECTS: '1',
        BLS_PREFETCH: '0',
        BLS_CACHE: join(tmpdir(), 'bls-e2e-service-cache'),
      },
    },
  ],
});
