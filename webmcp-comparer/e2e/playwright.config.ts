import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  use: {
    baseURL: 'http://localhost:3000',
    video: 'on',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    cwd: '..',
    timeout: 120_000,
  },
});
