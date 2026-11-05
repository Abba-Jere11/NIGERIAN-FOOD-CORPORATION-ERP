import { expect, test } from '@playwright/test';
import { apiLogin, csrfHeaders, goto } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M7 reports hub', () => {
  test('GM opens Reports and can reach procurement and finance catalogs', async ({ page }) => {
    await goto(page, '/home/gm', 'gm.yfz@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Reports', { exact: true })).toBeVisible();
    await nav.getByText('Reports', { exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Procurement' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open inventory reports' })).toBeVisible();

    await page.getByRole('link', { name: 'Open procurement reports' }).click();
    await expect(page).toHaveURL(/\/procurement\/reports$/);
    await expect(page.getByRole('heading', { name: 'Operational reports' })).toBeVisible();
  });

  test('Administrator sees Reports with no business data', async ({ page }) => {
    await goto(page, '/reports', 'administrator@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Reports', { exact: true })).toBeVisible();
    await expect(page.getByText('No business reports for this account')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Procurement' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Finance' })).toHaveCount(0);
    await goto(page, '/procurement/reports');
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test('MD shares a finance report PDF from the report page', async ({ page, playwright }) => {
    await goto(page, '/finance/reports/income_statement', 'md@nfc.local');
    await page.getByRole('button', { name: 'Share by email' }).click();
    await expect(page.getByRole('heading', { name: 'Share this report' })).toBeVisible();
    await page.getByLabel('Recipient').fill('board@example.com');
    await page.getByLabel('Covering note').fill('For the board pack.');
    await expect(page.getByText('Attached:')).toBeVisible();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText(/queued|sent from the Managing Director/i)).toBeVisible();

    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'md@nfc.local');
      const shared = await api.post(`${API}/api/finance/reports/income_statement/email`, {
        headers: await csrfHeaders(api),
        data: { recipient: 'audit.board@example.com', year: 2026, message: 'Official copy.' },
      });
      expect(shared.ok(), await shared.text()).toBeTruthy();
      const body = (await shared.json()) as { id: string; status: string; subject: string };
      expect(body.status).toBe('queued');
      expect(body.subject).toMatch(/RPT-/);
    } finally {
      await api.dispose();
    }
  });

  test('Officer opens inventory reports from the hub', async ({ page }) => {
    await goto(page, '/reports', 'inventory@nfc.local');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open inventory reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Finance' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open procurement reports' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open inventory reports' }).click();
    await expect(page).toHaveURL(/\/inventory\/reports/);
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  });
});
