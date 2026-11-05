import { expect, test } from '@playwright/test';
import { loginAs } from './support';

const OFFICER_NAV = ['Pending deliveries', 'Shortage tracker', 'Delivery history'] as const;

test.describe('M5 Officer operational home', () => {
  test('Officer sees delivery queues and can open each page', async ({ page }) => {
    await loginAs(page, 'inventory@nfc.local');
    await expect(page).toHaveURL(/\/home\/inventory$/);

    const nav = page.getByRole('navigation', { name: 'Modules' });
    for (const label of OFFICER_NAV) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText('Partially received', { exact: true })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending deliveries' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shortage tracker' })).toBeVisible();
    await expect(page.getByText('Paid requests waiting')).toHaveCount(0);

    await nav.getByText('Pending deliveries', { exact: true }).click();
    await expect(page).toHaveURL(/\/home\/inventory\/pending$/);
    await expect(page.getByRole('heading', { name: 'Pending deliveries' })).toBeVisible();

    await nav.getByText('Shortage tracker', { exact: true }).click();
    await expect(page).toHaveURL(/\/home\/inventory\/shortages$/);
    await expect(page.getByRole('heading', { name: 'Shortage tracker' })).toBeVisible();

    await nav.getByText('Delivery history', { exact: true }).click();
    await expect(page).toHaveURL(/\/home\/inventory\/history$/);
    await expect(page.getByRole('heading', { name: 'Delivery history' })).toBeVisible();
  });

  test('GM does not see Officer queues and is refused the pending page', async ({ page }) => {
    await loginAs(page, 'gm.yfz@nfc.local');
    await expect(page).toHaveURL(/\/home\/gm$/);

    const nav = page.getByRole('navigation', { name: 'Modules' });
    for (const label of OFFICER_NAV) {
      await expect(nav.getByText(label, { exact: true })).toHaveCount(0);
    }

    await page.goto('/home/inventory/pending');
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
  });
});
