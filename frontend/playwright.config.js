import { defineConfig } from '@playwright/test';

// E2E runs against a running stack (API + web) seeded with `npm run seed:demo` in backend/.
// Uses an installed Chrome when PW_CHROME_PATH is set; otherwise Playwright's bundled Chromium
// (run `npx playwright install chromium` once).
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: Boolean(process.env.E2E_IGNORE_HTTPS_ERRORS),
    launchOptions: process.env.PW_CHROME_PATH ? { executablePath: process.env.PW_CHROME_PATH, args: ['--no-sandbox', ...(process.env.PW_NO_PROXY ? ['--no-proxy-server'] : [])] } : {},
  },
});
