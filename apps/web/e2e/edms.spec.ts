import { expect, test } from '@playwright/test';
import { YFZ_EDMS_COMPLETED_ID, YFZ_PROCUREMENT_DRAFT_ID } from '@nfc/shared';
import { apiLogin, csrfHeaders, goto } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('M15 Document Portal', () => {
  test('EDMS is absent from Modules and MD sees five spaces before folders', async ({ page }) => {
    await goto(page, '/home/md', 'md@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Documents', { exact: true })).toHaveCount(0);
    await goto(page, '/edms');
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: /NFC/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Yobe Fertilizer/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Yobe Flour/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Damaturu Modern Abattoir/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Nguru Oil Mills/ })).toBeVisible();
    await expect(page.getByText('YFZ mill bag archive fixture')).toHaveCount(0);
    await page.getByRole('link', { name: /Yobe Fertilizer/ }).click();
    await expect(page.getByRole('heading', { name: /Yobe Fertilizer/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Active' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Archived' })).toBeVisible();
    await expect(page.getByRole('tree', { name: 'Folders' }).getByText('Procurement')).toBeVisible();
    await expect(page.getByText('Select a folder')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' })).toHaveCount(0);
  });

  test('GM is denied the portal and has no View in EDMS; MD has the link', async ({ page }) => {
    await goto(page, '/edms', 'gm.yfz@nfc.local');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to the Document Portal' }),
    ).toBeVisible();

    await goto(page, `/procurement/${YFZ_PROCUREMENT_DRAFT_ID}`);
    await expect(page.getByRole('link', { name: 'View in EDMS' })).toHaveCount(0);
    await expect(page.getByText('Generated memo')).toBeVisible();

    await goto(page, `/procurement/${YFZ_EDMS_COMPLETED_ID}`, 'md@nfc.local');
    const link = page.getByRole('link', { name: 'View in EDMS' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/edms\/YFZ\/folders\//);
    await page.goto(href!);
    await expect(page.getByRole('heading', { name: /YFZ mill bag archive fixture/ })).toBeVisible();
  });

  test('GM is refused on EDMS APIs; Administrator cannot read a filed document', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      expect((await gm.get(`${API}/api/edms/gateway`)).status()).toBe(403);
      expect((await gm.get(`${API}/api/edms/tree?entityId=${crypto.randomUUID()}`)).status()).toBe(403);
      const access = await gm.get(`${API}/api/edms/access`);
      expect(access.ok()).toBeTruthy();
      expect(await access.json()).toEqual({ allowed: false });

      const gateway = (await (await md.get(`${API}/api/edms/gateway`)).json()) as {
        entities: Array<{ id: string; code: string; documentCount: number }>;
      };
      const yfz = gateway.entities.find((entity) => entity.code === 'YFZ');
      expect(yfz).toBeTruthy();
      expect(typeof yfz!.documentCount).toBe('number');
      const tree = (await (await md.get(`${API}/api/edms/tree?entityId=${yfz!.id}`)).json()) as {
        active: { children: Array<{ id: string; name: string }> } | null;
      };
      const folder = tree.active?.children.find((child) => child.name === 'Administrative');
      expect(folder).toBeTruthy();
      const categories = (await (await md.get(`${API}/api/edms/categories`)).json()) as Array<{
        id: string;
        key: string;
      }>;
      const category = categories.find((row) => row.key === 'administrative');
      expect(category).toBeTruthy();
      const uploaded = await md.post(`${API}/api/edms/upload`, {
        headers: await csrfHeaders(md),
        multipart: {
          title: `Admin deny ${Date.now()}`,
          entityId: yfz!.id,
          folderId: folder!.id,
          categoryId: category!.id,
          file: { name: 'note.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
      const document = (await uploaded.json()) as { id: string };
      expect((await admin.get(`${API}/api/edms/documents/${document.id}`)).status()).toBe(403);
    } finally {
      await gm.dispose();
      await admin.dispose();
      await md.dispose();
    }
  });
});
