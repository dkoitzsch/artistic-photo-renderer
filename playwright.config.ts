import { defineConfig } from '@playwright/test';

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
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:5317',
    reuseExistingServer: true,
  },
});
