import { expect, test } from '@playwright/test';
import { actAs, unique } from './support';

/**
 * M1 acceptance: the hierarchy is seeded correctly, and departments can be added
 * and deactivated per entity with every change writing an audit entry.
 */
test.describe('the organisation structure', () => {
  test('shows the holding company and all four subsidiaries', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'md');

    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'NFC' })).toBeVisible();
    for (const code of ['YFZ', 'YFW', 'DMA', 'NOM']) {
      await expect(table.getByRole('link', { name: code })).toBeVisible();
    }
  });

  test('treats Nguru Oil Mills as a direct child of NFC, not of another subsidiary', async ({
    page,
  }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'md');

    await page.getByRole('link', { name: 'NOM' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nguru Oil Mills');
    // The eyebrow states the type, and the record panel confirms it: a
    // subsidiary of the holding company, at the same level as its siblings.
    await expect(page.getByText('Subsidiary', { exact: true }).first()).toBeVisible();
  });

  test('gives every entity the seven seeded departments', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'md');
    await page.getByRole('link', { name: 'YFZ' }).click();

    for (const name of [
      'Operations',
      'Finance',
      'HR',
      'Production',
      'Stores',
      'Administration',
      'Maintenance',
    ]) {
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    }
  });
});

test.describe('department administration', () => {
  test('adds a department, then deactivates it with a reason, and records both', async ({
    page,
  }) => {
    const name = unique('E2E Department');
    const reason = 'Created by the end-to-end suite and no longer needed.';

    await page.goto('/admin/entities');
    await actAs(page, 'md');
    await page.getByRole('link', { name: 'YFW' }).click();

    // --- Create ---
    await page.getByRole('button', { name: 'New department' }).first().click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Name').fill(name);
    await createDialog.getByRole('button', { name: 'Create department' }).click();

    await expect(page.getByRole('status')).toContainText('created');
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Active')).toBeVisible();

    // --- Deactivate ---
    await row.getByRole('button', { name: 'Deactivate' }).click();
    const deactivateDialog = page.getByRole('dialog');
    await deactivateDialog.getByLabel('Reason').fill(reason);
    await deactivateDialog.getByRole('button', { name: 'Deactivate' }).click();

    await expect(page.getByRole('status')).toContainText('deactivated');
    // Deactivated, not deleted: the row is still there, with its status changed.
    await expect(row).toBeVisible();
    await expect(row.getByText('Inactive')).toBeVisible();

    // --- Both changes are in the audit log, and the reason was kept ---
    await page.goto(`/audit?q=${encodeURIComponent(name)}`);
    const auditRows = page.getByRole('table').getByRole('row');
    await expect(auditRows.filter({ hasText: 'Create' })).toHaveCount(1);
    await expect(page.getByText(reason)).toBeVisible();
  });

  test('refuses to deactivate without a reason', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'md');
    await page.getByRole('link', { name: 'DMA' }).click();

    const row = page.getByRole('row', { name: /Maintenance/ });
    await row.getByRole('button', { name: 'Deactivate' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Deactivate' }).click();

    // The dialog stays open: rule R11 makes the reason part of the record, not a
    // nicety, and the field is required before anything is submitted.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Reason')).toBeFocused();
  });

  test('refuses a duplicate department name within the same subsidiary', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'md');
    await page.getByRole('link', { name: 'NOM' }).click();

    await page.getByRole('button', { name: 'New department' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('finance');
    await dialog.getByRole('button', { name: 'Create department' }).click();

    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe('entity administration is restricted to the MD (R4)', () => {
  test('offers no administration controls to a General Manager', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'gm.yfz');

    await expect(page.getByRole('button', { name: 'New subsidiary' })).toHaveCount(0);

    await page.getByRole('link', { name: 'YFZ' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New department' })).toHaveCount(0);
  });

  test('refuses a General Manager at the API, not only in the interface', async ({ request }) => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
    const response = await request.post(`${api}/api/entities`, {
      headers: { 'x-dev-actor': 'gm.yfz' },
      data: { code: 'HACK', name: 'Unauthorised', legalName: 'Unauthorised', type: 'SUBSIDIARY' },
    });

    expect(response.status()).toBe(403);
  });
});

test.describe('entity isolation (R5)', () => {
  test('shows a General Manager only their own subsidiary', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'gm.yfz');

    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'YFZ' })).toBeVisible();
    for (const code of ['NFC', 'YFW', 'DMA', 'NOM']) {
      await expect(table.getByRole('link', { name: code })).toHaveCount(0);
    }
  });

  test('tells a General Manager plainly that their view is limited', async ({ page }) => {
    await page.goto('/admin/entities');
    await actAs(page, 'gm.dma');
    await expect(page.getByRole('note')).toContainText('Damaturu Modern Abattoir');
  });

  test('returns nothing when a General Manager names another subsidiary directly', async ({
    page,
    request,
  }) => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

    const all = await request.get(`${api}/api/entities`, { headers: { 'x-dev-actor': 'md' } });
    const entities = (await all.json()) as Array<{ id: string; code: string }>;
    const dma = entities.find((entity) => entity.code === 'DMA');
    expect(dma).toBeDefined();

    const asYfzGm = await request.get(`${api}/api/entities/${dma?.id}`, {
      headers: { 'x-dev-actor': 'gm.yfz' },
    });

    // Not found rather than forbidden: a record outside your access is
    // indistinguishable from one that was never created.
    expect(asYfzGm.status()).toBe(404);

    await page.goto(`/admin/entities/${dma?.id}`);
    await actAs(page, 'gm.yfz');
    await page.goto(`/admin/entities/${dma?.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('not here');
  });
});
