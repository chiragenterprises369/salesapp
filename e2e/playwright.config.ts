import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e (orchestrator). Run from the repo root: `pnpm e2e` (build the web app first:
 * `pnpm --filter @vistar/web build`). Uses a running server at E2E_BASE_URL, or starts `next start`
 * on E2E_PORT (default 3000). Wave 1 suites run on the mock data layer (no API needed).
 * Folders: e2e/board/** (frontend-physics), e2e/team-floor/** (frontend-3d), everything else qa-reviewer.
 */
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: './.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { outputFolder: './.report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @vistar/web exec next start -p ${port}`,
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
