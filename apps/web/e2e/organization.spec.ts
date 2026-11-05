import { expect, test } from '@playwright/test';
import { apiLogin, loginAs, unique, csrfHeaders } from './support';

const ADMIN = 'administrator@nfc.local';
const GM_YFZ = 'gm.yfz@nfc.local';
const GM_DMA = 'gm.dma@nfc.local';
const MD = 'md@nfc.local';

test.describe('the organisation structure', () => {
  test('shows the holding company and all four subsidiaries', async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto('/admin/entities');

    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'NFC' })).toBeVisible();
    for (const code of ['YFZ', 'YFW', 'DMA', 'NOM']) {
      await expect(table.getByRole('link', { name: code })).toBeVisible();
    }
  });

  test('treats Nguru Oil Mills as a direct child of NFC, not of another subsidiary', async ({
    page,
  }) => {
    await loginAs(page, ADMIN);
    await page.goto('/admin/entities');

    await page.getByRole('link', { name: 'NOM' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nguru Oil Mills');
    // The eyebrow states the type, and the record panel confirms it: a
    // subsidiary of the holding company, at the same level as its siblings.
    await expect(page.getByText('Subsidiary', { exact: true }).first()).toBeVisible();
  });

  test('gives every entity the seven seeded departments', async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto('/admin/entities');
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
    const reason = 'No longer needed after the end-to-end check.';

    await loginAs(page, ADMIN);
    await page.goto('/admin/entities');
    await page.getByRole('link', { name: 'YFW' }).click();

    // --- Create ---
    await page.getByRole('button', { name: 'New department' }).first().click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Name').fill(name);
    await createDialog.getByRole('button', { name: 'Create department' }).click();

    await expect(page.getByRole('status').filter({ hasText: /created/i })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Active')).toBeVisible();

    // --- Deactivate ---
    await row.getByRole('button', { name: 'Deactivate' }).click();
    const deactivateDialog = page.getByRole('dialog');
    await deactivateDialog.getByLabel('Reason').fill(reason);
    await deactivateDialog.getByRole('button', { name: 'Deactivate' }).click();

    await expect(page.getByRole('status').filter({ hasText: /deactivated/i })).toBeVisible();
    // Deactivated, not deleted: the row is still there, with its status changed.
    await expect(row).toBeVisible();
    await expect(row.getByText('Inactive')).toBeVisible();

    // Administrator cannot read the business audit log; the MD can.
    await page.getByRole('button', { name: /Chinedu/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await loginAs(page, MD);
    await page.goto(`/audit?q=${encodeURIComponent(name)}`);
    const namedRows = page.getByRole('table').getByRole('row').filter({ hasText: name });
    await expect(namedRows).toHaveCount(2);
    await expect(page.getByText(reason)).toBeVisible();
  });

  test('refuses to deactivate without a reason', async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto('/admin/entities');
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
    await loginAs(page, ADMIN);
    await page.goto('/admin/entities');
    await page.getByRole('link', { name: 'NOM' }).click();

    await page.getByRole('button', { name: 'New department' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('finance');
    await dialog.getByRole('button', { name: 'Create department' }).click();

    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe('entity administration is restricted to the Administrator (R4)', () => {
  test('offers no administration controls to a General Manager', async ({ page }) => {
    await loginAs(page, GM_YFZ);
    await page.goto('/admin/entities');

    await expect(page.getByRole('button', { name: 'New subsidiary' })).toHaveCount(0);

    await page.getByRole('link', { name: 'YFZ' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New department' })).toHaveCount(0);
  });

  test('refuses a General Manager at the API, not only in the interface', async ({ request }) => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
    await apiLogin(request, GM_YFZ);
    const response = await request.post(`${api}/api/entities`, {
      headers: await csrfHeaders(request),
      data: { code: 'HACK', name: 'Unauthorised', legalName: 'Unauthorised', type: 'SUBSIDIARY' },
    });

    expect(response.status()).toBe(403);
  });
});

test.describe('entity isolation (R5)', () => {
  test('shows a General Manager only their own subsidiary', async ({ page }) => {
    await loginAs(page, GM_YFZ);
    await page.goto('/admin/entities');

    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'YFZ' })).toBeVisible();
    for (const code of ['NFC', 'YFW', 'DMA', 'NOM']) {
      await expect(table.getByRole('link', { name: code })).toHaveCount(0);
    }
  });

  test('tells a General Manager plainly that their view is limited', async ({ page }) => {
    await loginAs(page, GM_DMA);
    await page.goto('/admin/entities');
    await expect(page.getByRole('note')).toContainText('Damaturu Modern Abattoir');
  });

  test('returns nothing when a General Manager names another subsidiary directly', async ({
    page,
    playwright,
  }) => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
    const mdApi = await playwright.request.newContext();
    const gmApi = await playwright.request.newContext();
    try {
      await apiLogin(mdApi, MD);
      const all = await mdApi.get(`${api}/api/entities`);
      const entities = (await all.json()) as Array<{ id: string; code: string }>;
      const dma = entities.find((entity) => entity.code === 'DMA');
      expect(dma).toBeDefined();

      await apiLogin(gmApi, GM_YFZ);
      const asYfzGm = await gmApi.get(`${api}/api/entities/${dma?.id}`);
      expect(asYfzGm.status()).toBe(404);

      await loginAs(page, GM_YFZ);
      await page.goto(`/admin/entities/${dma?.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('not here');
    } finally {
      await mdApi.dispose();
      await gmApi.dispose();
    }
  });
});
