import { expect, test } from '@playwright/test';
import { apiLogin, goto } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M14 inventory production and sales', () => {
  test('officer opens YFW production and YFZ sales', async ({ page }) => {
    await goto(page, '/inventory/production?scope=YFW', 'inventory@nfc.local');
    await expect(page.getByRole('heading', { name: 'Production' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' }).getByText('Production')).toBeVisible();
    await goto(page, '/inventory/sales?scope=YFZ');
    await expect(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
    await expect(page.getByText('Reserve stock, dispatch, then invoice')).toBeVisible();
  });

  test('GM YFZ cannot open DMA sales', async ({ page, playwright }) => {
    await goto(page, '/inventory/sales?scope=YFZ', 'gm.yfz@nfc.local');
    await expect(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'gm.yfz@nfc.local');
      const officer = await playwright.request.newContext();
      try {
        await apiLogin(officer, 'inventory@nfc.local');
        const all = (await (await officer.get(`${API}/api/inventory/context`)).json()) as {
          entities: Array<{ id: string; code: string }>;
        };
        const dma = all.entities.find((entity) => entity.code === 'DMA');
        expect(dma).toBeTruthy();
        const blocked = await api.get(`${API}/api/inventory/sales?entityId=${dma!.id}`);
        expect(blocked.status()).toBe(403);
      } finally {
        await officer.dispose();
      }
    } finally {
      await api.dispose();
    }
  });

  test('ED Operations sees the production approval queue', async ({ page }) => {
    await goto(page, '/inventory/production?scope=YFZ', 'ed.operations@nfc.local');
    await expect(page.getByRole('heading', { name: 'Production' })).toBeVisible();
    await expect(page.getByText('GM or ED Operations approves')).toBeVisible();
  });
});
