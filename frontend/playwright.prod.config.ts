import { defineConfig, devices } from '@playwright/test';

/**
 * Production smoke-test config. Used when PLAYWRIGHT_BASE_URL is set
 * to ainpi.vercel.app (or a preview URL); skips the local webServer
 * boot. Run with `npx playwright test --config=playwright.prod.config.ts`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 4,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://ainpi.vercel.app',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
