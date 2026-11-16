import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: process.env.SHIFT_MARKET_TEST_BASE_URL ?? 'http://localhost:80',
    trace: 'retain-on-failure',
    // Optional: point at a locally available Chromium when Playwright's own browsers are not installed.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
});