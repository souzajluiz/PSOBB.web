// Playwright config for the admin panel specs (e2e/admin-*.spec.ts). They start
// their own newserv (a temporary copy of vendor/newserv/system) and their own
// bridge/server.mjs, so no Vite and no shared server is needed or touched.
// Run: cd client && npx playwright test -c playwright.admin.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /admin-.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    channel: 'chrome',
    locale: 'en-US', // the panel follows the browser language; the specs read English

    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
