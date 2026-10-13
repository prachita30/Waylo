import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against an isolated API (port 4100, fresh embedded database) and
 * web dev server (port 5174), so they never touch the regular development database.
 * Browser: the locally installed Microsoft Edge or Chrome (set E2E_CHANNEL), so no
 * browser download is needed.
 */
const API_PORT = 4100;
const WEB_PORT = 5174;
const channel = process.env.E2E_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npm run serve:e2e -w @waylo/api',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        PGLITE_DIR: '.data/e2e-pglite',
        UPLOAD_DIR: '.data/e2e-uploads',
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        AUTH_RATE_LIMIT: '1000',
        API_RATE_LIMIT: '100000',
        LOG_LEVEL: 'warn',
        PAYMENT_WEBHOOK_SECRET: 'e2e-only-webhook-secret',
      },
    },
    {
      command: 'npm run dev -w @waylo/web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WEB_PORT: String(WEB_PORT), WAYLO_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
