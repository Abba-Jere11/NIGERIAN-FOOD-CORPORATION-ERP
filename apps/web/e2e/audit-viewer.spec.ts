import { expect, test } from '@playwright/test';
import { apiLogin, loginAs } from './support';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const MD = 'md@nfc.local';
const ED_FINANCE = 'ed.finance@nfc.local';

test.describe('the audit viewer', () => {
  test('shows the Managing Director the log, with filters and pagination', async ({ page }) => {
    await loginAs(page, MD);
    await page.goto('/audit');

    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    const filters = page.locator('form[action="/audit"]');
    await expect(filters.locator('select[name="action"]')).toBeVisible();
    await expect(filters.locator('select[name="entityId"]')).toBeVisible();
    await expect(filters.locator('input[name="actor"]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('offers nothing that could change an entry', async ({ page }) => {
    await loginAs(page, MD);
    await page.goto('/audit');

    const table = page.locator('table');
    await expect(table.getByRole('button', { name: /edit|delete|remove/i })).toHaveCount(0);
    await expect(page.getByRole('textbox').and(table.locator('input'))).toHaveCount(0);
  });

  test('filters by action, and keeps the filter in the address', async ({ page }) => {
    await loginAs(page, MD);
    await page.goto('/audit');

    await page.locator('form[action="/audit"]').locator('select[name="action"]').selectOption('create');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(page).toHaveURL(/action=create/);
    const actionCells = page.getByRole('table').getByRole('row');
    await expect(actionCells.filter({ hasText: 'Create' }).first()).toBeVisible();
  });

  test('finds the seeding entries, attributed to a named system actor', async ({ page }) => {
    await loginAs(page, MD);
    await page.goto('/audit?actor=system%3Aseed');

    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByText('Seed process').first()).toBeVisible();
  });

  test('exports a CSV, and records the export as an action in the log', async ({ page }) => {
    await loginAs(page, MD);
    await page.goto('/audit');

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export CSV' }).click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toMatch(/^nfc-audit-log-\d{4}-\d{2}-\d{2}\.csv$/);

    await page.goto('/audit?action=download');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByText('Audit log export').first()).toBeVisible();
  });

  test('shows the whole entry, including the reason and the request provenance', async ({
    page,
  }) => {
    await loginAs(page, MD);
    await page.goto('/audit');

    await page.getByRole('group').first().getByText('Detail').click();
    await expect(page.getByText('Entry id').first()).toBeVisible();
    await expect(page.getByText('Request').first()).toBeVisible();
  });
});

test.describe('the audit log is restricted to the MD and ED Finance', () => {
  test('lets ED Finance in', async ({ page }) => {
    await loginAs(page, ED_FINANCE);
    await page.goto('/audit');
    await expect(page.getByRole('table')).toBeVisible();
  });

  for (const email of ['gm.yfz@nfc.local', 'ed.operations@nfc.local', 'fh.nom@nfc.local'] as const) {
    test(`refuses ${email} in the interface`, async ({ page }) => {
      await loginAs(page, email);
      await expect(
        page.getByRole('navigation', { name: 'Modules' }).getByText('Audit log'),
      ).toHaveCount(0);

      await page.goto('/audit');
      await expect(page.getByRole('alert').filter({ hasText: /cannot view the audit log/i })).toBeVisible();
    });
  }

  for (const email of ['gm.yfz@nfc.local', 'ed.operations@nfc.local', 'fh.nom@nfc.local'] as const) {
    test(`refuses ${email} at the API`, async ({ playwright }) => {
      const api = await playwright.request.newContext();
      try {
        await apiLogin(api, email);
        const list = await api.get(`${API_URL}/api/audit`);
        expect(list.status()).toBe(403);
        const exported = await api.get(`${API_URL}/api/audit/export`);
        expect(exported.status()).toBe(403);
      } finally {
        await api.dispose();
      }
    });
  }
});

test.describe('audit entries cannot be changed through the API either', () => {
  test('offers no endpoint that edits or removes an entry', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, MD);
      const entries = await api.get(`${API_URL}/api/audit?pageSize=1`);
      const page1 = (await entries.json()) as { rows: Array<{ id: string }> };
      const id = page1.rows[0]?.id;
      expect(id).toBeTruthy();

      for (const method of ['patch', 'post', 'delete'] as const) {
        const response = await api[method](`${API_URL}/api/audit/${id}`, {
          ...(method === 'delete' ? {} : { data: { reason: 'rewritten' } }),
        });
        expect([404, 405]).toContain(response.status());
      }
    } finally {
      await api.dispose();
    }
  });
});
