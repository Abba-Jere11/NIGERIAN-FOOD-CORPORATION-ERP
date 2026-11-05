import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function loadRootEnv(): void {
  const envPath = resolve(__dirname, '../../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const WEB_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/**
 * End-to-end tests run against the built API and the built web application, both
 * talking to the real PostgreSQL test database. Nothing is mocked: a test that
 * passes here has exercised the triggers, the Row-Level Security policies and
 * the audit writes.
 *
 * The suite assumes the test database has been migrated and seeded e2e-ready
 * (`pnpm db:migrate --test && pnpm db:seed --test` with SEED_E2E_SKIP_MUST_CHANGE).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: WEB_URL,
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @nfc/api start',
      cwd: '../..',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PGDATABASE: process.env.PGDATABASE_TEST ?? 'nfc_erp_test',
        DATABASE_URL: '',
        HIBP_ENABLED: 'false',
      },
    },
    {
      command: 'pnpm --filter @nfc/web start',
      cwd: '../..',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    },
  ],
});
