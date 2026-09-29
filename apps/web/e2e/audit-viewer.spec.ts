import { expect, test } from '@playwright/test';
import { actAs } from './support';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/** M1 item 7: a read-only, scope-limited audit viewer with filters and export. */
test.describe('the audit viewer', () => {
  test('shows the Managing Director the log, with filters and pagination', async ({ page }) => {
    await page.goto('/audit');
    await actAs(page, 'md');

    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expect(page.getByLabel('Action')).toBeVisible();
    await expect(page.getByLabel('Entity')).toBeVisible();
    await expect(page.getByLabel('Actor')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('offers nothing that could change an entry', async ({ page }) => {
    await page.goto('/audit');
    await actAs(page, 'md');

    // The table refuses UPDATE and DELETE outright, so a control that appeared to
    // edit an entry could only ever produce an error.
    const table = page.locator('table');
    await expect(table.getByRole('button', { name: /edit|delete|remove/i })).toHaveCount(0);
    await expect(page.getByRole('textbox').and(table.locator('input'))).toHaveCount(0);
  });

  test('filters by action, and keeps the filter in the address', async ({ page }) => {
    await page.goto('/audit');
    await actAs(page, 'md');

    await page.getByLabel('Action').selectOption('create');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(page).toHaveURL(/action=create/);
    const actionCells = page.getByRole('table').getByRole('row');
    await expect(actionCells.filter({ hasText: 'Create' }).first()).toBeVisible();
  });

  test('finds the seeding entries, attributed to a named system actor', async ({ page }) => {
    await page.goto('/audit?actor=system%3Aseed');
    await actAs(page, 'md');
    await page.goto('/audit?actor=system%3Aseed');

    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByText('Seed process').first()).toBeVisible();
  });

  test('exports a CSV, and records the export as an action in the log', async ({ page }) => {
    await page.goto('/audit');
    await actAs(page, 'md');

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export CSV' }).click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toMatch(/^nfc-audit-log-\d{4}-\d{2}-\d{2}\.csv$/);

    // Taking data out of the system is itself a recorded action.
    await page.goto('/audit?action=download');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByText('Audit log export').first()).toBeVisible();
  });

  test('shows the whole entry, including the reason and the request provenance', async ({
    page,
  }) => {
    await page.goto('/audit');
    await actAs(page, 'md');

    await page.getByRole('group').first().getByText('Detail').click();
    await expect(page.getByText('Entry id').first()).toBeVisible();
    await expect(page.getByText('Request').first()).toBeVisible();
  });
});

test.describe('the audit log is restricted to the MD and ED Finance (M1 item 7)', () => {
  test('lets ED Finance in', async ({ page }) => {
    await page.goto('/audit');
    await actAs(page, 'ed.finance');
    await expect(page.getByRole('table')).toBeVisible();
  });

  for (const actor of ['gm.yfz', 'ed.operations', 'fh.nom']) {
    test(`refuses ${actor} in the interface`, async ({ page }) => {
      await page.goto('/');
      await actAs(page, actor);

      // The module is not offered...
      await expect(page.getByRole('navigation', { name: 'Modules' }).getByText('Audit log')).toHaveCount(
        0,
      );

      // ...and typing the address is refused rather than merely hidden.
      await page.goto('/audit');
      await expect(page.getByRole('alert')).toContainText('cannot view the audit log');
    });
  }

  for (const actor of ['gm.yfz', 'ed.operations', 'fh.nom']) {
    test(`refuses ${actor} at the API`, async ({ request }) => {
      const list = await request.get(`${API_URL}/api/audit`, {
        headers: { 'x-dev-actor': actor },
      });
      expect(list.status()).toBe(403);

      const exported = await request.get(`${API_URL}/api/audit/export`, {
        headers: { 'x-dev-actor': actor },
      });
      expect(exported.status()).toBe(403);
    });
  }
});

/** M1 acceptance: UPDATE and DELETE on audit_log fail at the database level. */
test.describe('audit entries cannot be changed through the API either', () => {
  test('offers no endpoint that edits or removes an entry', async ({ request }) => {
    const entries = await request.get(`${API_URL}/api/audit?pageSize=1`, {
      headers: { 'x-dev-actor': 'md' },
    });
    const page1 = (await entries.json()) as { rows: Array<{ id: string }> };
    const id = page1.rows[0]?.id;
    expect(id).toBeTruthy();

    for (const method of ['patch', 'post', 'delete'] as const) {
      const response = await request[method](`${API_URL}/api/audit/${id}`, {
        headers: { 'x-dev-actor': 'md' },
        ...(method === 'delete' ? {} : { data: { reason: 'rewritten' } }),
      });
      expect([404, 405]).toContain(response.status());
    }
  });
});
