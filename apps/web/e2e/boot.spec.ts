import { expect, test } from '@playwright/test';
import { loginAs } from './support';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('the system boots', () => {
  test('the API reports a healthy database', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      status: string;
      checks: { database: string; databaseLatencyMs: number };
    };
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('up');
    expect(body.checks.databaseLatencyMs).toBeGreaterThanOrEqual(0);
  });

  test('the sign-in page is the only unauthenticated screen', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('the home page identifies the organisation after sign-in', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await loginAs(page, 'md@nfc.local');
    await expect(
      page.getByRole('banner').getByRole('link', { name: /Nigeria Food Corporation/i }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(failures).toEqual([]);
  });

  test('the shell search box and notification bell are available', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await expect(page.getByLabel('Global search')).toBeEnabled();
    await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();
  });

  test('refuses an unauthenticated caller rather than falling back to a privileged one', async ({
    request,
  }) => {
    const response = await request.get(`${API_URL}/api/me`);
    expect(response.status()).toBe(401);
  });
});
