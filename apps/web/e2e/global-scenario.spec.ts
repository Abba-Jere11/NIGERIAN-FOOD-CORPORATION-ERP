import { expect, test } from '@playwright/test';
import { loginAs } from './support';

test.describe('M19 global scenario smoke', () => {
  test('MD can search a procurement reference from the header', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await page.getByLabel('Global search').fill('PR-');
    await page.getByLabel('Global search').press('Enter');
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('corporate home links to role dashboard', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await page.getByRole('link', { name: 'My role dashboard' }).click();
    await expect(page).toHaveURL(/\/home\/md/);
  });
});
