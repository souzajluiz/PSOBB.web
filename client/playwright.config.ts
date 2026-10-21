// End-to-end tests of the classic client against a local newserv.
// Needs newserv (vendor/newserv) and the bridge (bridge/bridge.mjs) running;
// Vite is started here when it is not already up. See e2e/README.md.
import { defineConfig } from '@playwright/test';

// PW_BASE_URL points the tests at another dev server (a worktree's Vite on
// its own port); the default is the checkout's Vite.
const BASE_URL = process.env.PW_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // One account, one server: the tests share the login and must not overlap.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: `${BASE_URL}/classic.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
