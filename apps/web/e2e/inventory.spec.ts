import { expect, test } from '@playwright/test';
import { apiLogin, goto } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M13 inventory', () => {
  test('officer opens YFZ stock, item detail and expected versus on-hand', async ({ page }) => {
    await goto(page, '/inventory?scope=YFZ', 'inventory@nfc.local');
    await expect(page.getByRole('heading', { name: /YFZ stock/ })).toBeVisible();
    await expect(page.getByText('On-hand value')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' }).getByText('Inventory', { exact: true })).toBeVisible();
    const item = page.getByRole('link', { name: /YFZ-UREA/ }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByRole('heading', { name: /YFZ-UREA/ })).toBeVisible();
    await expect(page.getByText('weighted average')).toBeVisible();
    await goto(page, '/inventory/expected?scope=YFZ');
    await expect(page.getByRole('heading', { name: 'Expected stock' })).toBeVisible();
    await expect(page.getByText('This is not on hand')).toBeVisible();
  });

  test('GM YFZ cannot open DMA inventory', async ({ page, playwright }) => {
    await goto(page, '/inventory?scope=YFZ', 'gm.yfz@nfc.local');
    await expect(page.getByRole('heading', { name: /YFZ stock/ })).toBeVisible();
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'gm.yfz@nfc.local');
      const context = (await (await api.get(`${API}/api/inventory/context`)).json()) as {
        entities: Array<{ id: string; code: string }>;
      };
      expect(context.entities.some((entity) => entity.code === 'DMA')).toBeFalsy();
      const officer = await playwright.request.newContext();
      try {
        await apiLogin(officer, 'inventory@nfc.local');
        const all = (await (await officer.get(`${API}/api/inventory/context`)).json()) as {
          entities: Array<{ id: string; code: string }>;
        };
        const dma = all.entities.find((entity) => entity.code === 'DMA');
        expect(dma).toBeTruthy();
        const blocked = await api.get(`${API}/api/inventory/items?entityId=${dma!.id}`);
        expect(blocked.status()).toBe(403);
      } finally {
        await officer.dispose();
      }
    } finally {
      await api.dispose();
    }
  });

  test('ED Operations sees the adjustment queue', async ({ page }) => {
    await goto(page, '/inventory/adjustments?scope=YFZ', 'ed.operations@nfc.local');
    await expect(page.getByRole('heading', { name: 'Adjustments' })).toBeVisible();
    await expect(page.getByText('Officer prepares; GM or ED Operations approves')).toBeVisible();
  });

  test('officer can switch consolidated and subsidiary inventory', async ({ page, playwright }) => {
    await goto(page, '/inventory', 'inventory@nfc.local');
    await expect(page.getByRole('heading', { name: 'Consolidated inventory' })).toBeVisible();
    await expect(page.getByText('Viewing Consolidated (accessible subsidiaries)')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' }).getByText('Dashboard')).toBeVisible();
    await goto(page, '/inventory?scope=YFZ');
    await expect(page.getByRole('heading', { name: /YFZ stock/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /YFZ-UREA/ }).first()).toBeVisible();
    await goto(page, '/inventory?scope=DMA');
    await expect(page.getByRole('heading', { name: /DMA stock/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /YFZ-UREA/ })).toHaveCount(0);

    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'inventory@nfc.local');
      const group = (await (await api.get(`${API}/api/inventory`)).json()) as {
        consolidated: boolean;
        itemCount: number;
        onHandValueKobo: number;
      };
      expect(group.consolidated).toBe(true);
      const context = (await (await api.get(`${API}/api/inventory/context`)).json()) as {
        canConsolidate: boolean;
        entities: Array<{ id: string; code: string }>;
      };
      expect(context.canConsolidate).toBe(true);
      let itemCount = 0;
      let value = 0;
      for (const entity of context.entities) {
        const one = (await (await api.get(`${API}/api/inventory?entityId=${entity.id}`)).json()) as {
          itemCount: number;
          onHandValueKobo: number;
        };
        itemCount += one.itemCount;
        value += one.onHandValueKobo;
      }
      expect(group.itemCount).toBe(itemCount);
      expect(group.onHandValueKobo).toBe(value);
    } finally {
      await api.dispose();
    }
  });

  test('GM cannot open consolidated inventory', async ({ page, playwright }) => {
    await goto(page, '/inventory?scope=consolidated', 'gm.yfz@nfc.local');
    await expect(page.getByRole('heading', { name: /YFZ stock/ })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Consolidated' })).toHaveCount(0);
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'gm.yfz@nfc.local');
      const blocked = await api.get(`${API}/api/inventory`);
      expect(blocked.status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });
});
