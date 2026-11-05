import { expect, test } from '@playwright/test';
import { apiLogin, loginAs } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M12 finance reports', () => {
  test('ED Finance opens the report catalog and a consolidated income statement', async ({ page }) => {
    await loginAs(page, 'ed.finance@nfc.local');
    await page.goto('/finance/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Income statement' })).toBeVisible();
    await page.goto('/finance/reports/income_statement?scope=consolidated&year=2026');
    await expect(page.getByRole('heading', { name: 'Income statement' })).toBeVisible();
    await expect(page.getByText('Net income')).toBeVisible();
    const amount = page.getByRole('link').filter({ hasText: '₦' }).first();
    await amount.click();
    await expect(page.getByRole('heading', { name: 'Ledger lines' })).toBeVisible();
  });

  test('integrity lists the seeded IC mismatch', async ({ page }) => {
    await loginAs(page, 'ed.finance@nfc.local');
    await page.goto('/finance/reports/integrity?scope=consolidated');
    await expect(page.getByRole('heading', { name: 'Integrity' })).toBeVisible();
    await expect(page.getByText('Inter-company pairs')).toBeVisible();
    await expect(page.getByText('Fail')).toBeVisible();
  });

  test('YFZ Finance Head cannot run a DMA or consolidated report', async ({ playwright }) => {
    const yfz = await playwright.request.newContext();
    const ed = await playwright.request.newContext();
    try {
      await apiLogin(yfz, 'fh.yfz@nfc.local');
      await apiLogin(ed, 'ed.finance@nfc.local');
      const edEntities = (await (await ed.get(`${API}/api/finance/context`)).json()) as {
        entities: Array<{ id: string; code: string }>;
      };
      const dma = edEntities.entities.find((entity) => entity.code === 'DMA');
      expect(dma).toBeTruthy();
      const dmaReport = await yfz.get(`${API}/api/finance/reports/income_statement?entityId=${dma!.id}`);
      expect(dmaReport.status()).toBe(403);
      const consolidated = await yfz.get(`${API}/api/finance/reports/income_statement?consolidated=true`);
      expect(consolidated.status()).toBe(403);
    } finally {
      await yfz.dispose();
      await ed.dispose();
    }
  });
});
