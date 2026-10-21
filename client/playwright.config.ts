// End-to-end tests of the classic client against a local newserv.
// Needs newserv (vendor/newserv) and the bridge (bridge/bridge.mjs) running;
// Vite is started here when it is not already up. See e2e/README.md.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // One account, one server: the tests share the login and must not overlap.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173/classic.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
