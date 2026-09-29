import { expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/** M1 acceptance: the application boots, and its dependencies are reachable. */
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

  test('the home page identifies the organisation and loads without error', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));

    await page.goto('/');

    await expect(page.getByRole('link', { name: /Nigeria Food Corporation/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(failures).toEqual([]);
  });

  test('the shell shows the search box and notification bell as not yet available', async ({
    page,
  }) => {
    await page.goto('/');

    // They are deliberately inert in M1: the global search service and the
    // notification engine arrive in M3, and a control that pretends to work is
    // worse than one that says it does not.
    await expect(page.getByLabel('Global search (available from M3)')).toBeDisabled();
    await expect(page.getByLabel('Notifications (available from M3)')).toBeDisabled();
  });

  test('refuses an unknown actor rather than falling back to a privileged one', async ({
    request,
  }) => {
    const response = await request.get(`${API_URL}/api/me`, {
      headers: { 'x-dev-actor': 'not-a-real-actor' },
    });
    expect(response.status()).toBe(401);
  });
});
