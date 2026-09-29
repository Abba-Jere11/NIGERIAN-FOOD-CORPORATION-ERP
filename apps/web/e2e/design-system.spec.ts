import { expect, test } from '@playwright/test';

/**
 * M1 acceptance: every design-system component renders on `/design`, and the
 * approval tracker shows the three marks.
 */
test.describe('the design system reference', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design');
  });

  test('renders a section for every part of the vocabulary', async ({ page }) => {
    for (const title of [
      'Colour',
      'Buttons',
      'Status badges',
      'Approval tracker',
      'Forms',
      'Money and time',
      'Data table',
      'Timeline',
      'Empty, loading and error states',
      'Dialogs and toasts',
      'Print',
    ]) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
  });

  test('shows the approval tracker as done, current and pending', async ({ page }) => {
    const tracker = page.getByRole('list').filter({ hasText: 'MD approval' }).first();

    // The marks are ✓ ● ○. They are decorative to a screen reader, which is
    // given the state in words instead, so both are checked.
    await expect(tracker).toContainText('\u2713');
    await expect(tracker).toContainText('\u25CF');
    await expect(tracker).toContainText('\u25CB');
    await expect(tracker.getByText('completed').first()).toBeAttached();
    await expect(tracker.getByText('current stage').first()).toBeAttached();
    await expect(tracker.getByText('not started').first()).toBeAttached();
  });

  test('renders the whole status vocabulary as badges', async ({ page }) => {
    for (const label of [
      'Active',
      'Draft',
      'Awaiting Md',
      'Payment Processing',
      'Completed',
      'Rejected',
      'Blacklisted',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('shows a form field carrying the error the server enforced', async ({ page }) => {
    const code = page.getByLabel('Code', { exact: false }).first();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByText('Use capital letters and digits only, for example YFZ.'),
    ).toBeVisible();
  });

  test('submits money as exact integer kobo, never as a float', async ({ page }) => {
    const amount = page.getByLabel('Amount', { exact: false }).first();
    await amount.fill('12,500.50');

    const hidden = page.locator('input[type="hidden"][name="amountKobo"]');
    await expect(hidden).toHaveValue('1250050');

    // The amount in words is what a memo or payment document has to carry, so it
    // is shown before anyone approves anything.
    await expect(
      page.getByText('Twelve Thousand, Five Hundred Naira and Fifty Kobo Only'),
    ).toBeVisible();
  });

  test('refuses an amount with more than two decimal places', async ({ page }) => {
    const amount = page.getByLabel('Amount', { exact: false }).first();
    await amount.fill('10.005');

    await expect(page.locator('input[type="hidden"][name="amountKobo"]')).toHaveValue('');
  });

  test('sorts, filters, paginates and exports the data table', async ({ page }) => {
    const table = page.getByRole('table').filter({ hasText: 'Reference' });

    // Paginated: the exhibit holds four rows with a page size of three.
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();

    // Filtered.
    await page.getByPlaceholder('Filter by reference, vendor or status').fill('Sahel');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(page.getByText('1 of 4 rows')).toBeVisible();

    // Sorted.
    await page.getByPlaceholder('Filter by reference, vendor or status').fill('');
    await page.getByRole('button', { name: 'Sort by Vendor' }).click();
    await expect(table.getByRole('row').nth(1)).toContainText('Benue Oil Mills');

    // Exported.
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe('design-example.csv');
  });

  test('confirms a destructive action, and requires a reason where one is required', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Deactivate with a reason' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Nothing is deleted')).toBeVisible();

    await dialog.getByLabel('Reason').fill('Too short');
    await dialog.getByRole('button', { name: 'Deactivate' }).click();
    await expect(dialog.getByText(/at least five characters/)).toBeVisible();

    await dialog.getByLabel('Reason').fill('A full explanation of why this is being deactivated.');
    await dialog.getByRole('button', { name: 'Deactivate' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText('deactivated');
  });

  test('keeps a failed action open and reports why', async ({ page }) => {
    await page.getByRole('button', { name: 'An action that fails' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog.getByRole('alert')).toContainText('changed by someone else');
    await expect(dialog.getByText('Request id: 01J8Z9K3QX4M7VH2')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('closes a dialog on Escape without doing anything', async ({ page }) => {
    await page.getByRole('button', { name: 'Confirm an action' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('shows toasts for each tone', async ({ page }) => {
    await page.getByRole('button', { name: 'Success toast' }).click();
    await expect(page.getByRole('status')).toContainText('Department created.');

    await page.getByRole('button', { name: 'Error toast' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'already in use' })).toBeVisible();
  });

  test('displays times in Lagos on a 24-hour clock', async ({ page }) => {
    // 09:14 UTC is 10:14 in Lagos. A 12-hour clock in a document that records
    // financial movement is an invitation to misread it.
    await expect(page.getByText('21/09/2026 10:14').first()).toBeVisible();
  });

  test('hides the application furniture when printing', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeHidden();
    await expect(page.getByLabel('Acting as')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible();
  });
});
