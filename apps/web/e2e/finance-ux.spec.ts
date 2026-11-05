import { expect, test } from '@playwright/test';
import { loginAs } from './support';

test.describe('Finance UX landing', () => {
  test('ED Finance sees Position KPIs, consolidated scope and NFC comparison', async ({ page }) => {
    await loginAs(page, 'ed.finance@nfc.local');
    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: 'Position' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' }).getByText('Money')).toBeVisible();
    await expect(page.getByText('Cash position')).toBeVisible();
    await expect(page.getByText('Outstanding receivables')).toBeVisible();
    await expect(page.getByText('Available balance')).toBeVisible();
    await expect(page.getByText('Total budget')).toBeVisible();
    await expect(page.getByText('Viewing Consolidated')).toBeVisible();

    await page.getByRole('link', { name: /Available/i }).first().click();
    await expect(page).toHaveURL(/\/finance\/budgets\/activity\?metric=available/);
    await expect(page.getByRole('heading', { name: 'Available balance' })).toBeVisible();
    await expect(page.getByText(/Approved minus open commitments/i)).toBeVisible();

    await page.goto('/finance/dashboard?scope=consolidated');
    await expect(page).toHaveURL(/\/finance(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Position' })).toBeVisible();
    await expect(page.getByText('Entity comparison')).toBeVisible();
    await expect(page.getByRole('link', { name: 'NFC' }).first()).toBeVisible();

    await page.getByLabel('Entity').selectOption('YFZ');
    await expect(page).toHaveURL(/scope=YFZ/);
    await expect(page.getByText('Viewing YFZ')).toBeVisible();
    await expect(page.getByText('Live position for YFZ')).toBeVisible();
  });

  test('YFZ Finance Head has entity scope only', async ({ page }) => {
    await loginAs(page, 'fh.yfz@nfc.local');
    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: 'Position' })).toBeVisible();
    await expect(page.getByText('Viewing YFZ')).toBeVisible();
    await expect(page.getByLabel('Entity')).not.toContainText('Consolidated');
  });
});
