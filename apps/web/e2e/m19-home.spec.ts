import { expect, test } from '@playwright/test';
import { apiLogin, loginAs } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M19 corporate home', () => {
  test('login lands on /home corporate summary', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good day/i);
    await expect(page.getByText('Pending actions')).toBeVisible();
  });

  test('subsidiary finance link is present for MD', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await expect(page.getByRole('link', { name: 'Finance' }).first()).toBeVisible();
  });

  test('home summary API returns subsidiaries for MD', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'md@nfc.local');
      const res = await api.get(`${API}/api/home/summary`);
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as { subsidiaries: Array<{ code: string }> };
      expect(body.subsidiaries.length).toBeGreaterThan(0);
    } finally {
      await api.dispose();
    }
  });
});
