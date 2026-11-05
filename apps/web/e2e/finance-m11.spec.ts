import { expect, test } from '@playwright/test';
import { NFC_YFZ_ICT_ID, YFZ_CUSTOMER_ID } from '@nfc/shared';
import { apiLogin, loginAs } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M11 finance', () => {
  test('ED Finance sees dashboard tiles, customers and the seeded IC pair', async ({ page }) => {
    await loginAs(page, 'ed.finance@nfc.local');
    await page.goto('/finance/dashboard');
    await expect(page.getByRole('heading', { name: 'Position' })).toBeVisible();
    await expect(page.getByText('Cash position')).toBeVisible();
    await expect(page.getByText('Outstanding receivables')).toBeVisible();
    await expect(page.getByText('Outstanding payables')).toBeVisible();
    await expect(page.getByText('Inter-company transfers')).toBeVisible();
    await expect(page.getByText('Staff costs stay out of this milestone.')).toBeVisible();
    await expect(page.getByText('Payroll', { exact: true })).toHaveCount(0);

    await page.goto('/finance/customers');
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
    await expect(page.getByText('Maiduguri Grain Traders')).toBeVisible();
    await page.goto(`/finance/customers/${YFZ_CUSTOMER_ID}`);
    await expect(page.getByText('Maiduguri Grain Traders')).toBeVisible();

    await page.goto('/finance/receivables');
    await expect(page.getByRole('heading', { name: /Receivable/i })).toBeVisible();

    await page.goto('/finance/intercompany');
    await expect(page.getByText('TRF-2026-000901')).toBeVisible();
    await page.goto(`/finance/intercompany/${NFC_YFZ_ICT_ID}`);
    await expect(page.getByText('TRF-2026-000901')).toBeVisible();
  });

  test('YFZ Finance Head cannot open the DMA dashboard or DMA customers', async ({ playwright, page }) => {
    const yfz = await playwright.request.newContext();
    const ed = await playwright.request.newContext();
    try {
      await apiLogin(yfz, 'fh.yfz@nfc.local');
      await apiLogin(ed, 'ed.finance@nfc.local');
      const edEntities = (await (await ed.get(`${API}/api/finance/context`)).json()) as {
        entities: Array<{ id: string; code: string }>;
      };
      const dma = edEntities.entities.find((entity) => entity.code === 'DMA');
      expect(dma).toBeTruthy();
      const dmaDash = await yfz.get(`${API}/api/finance/dashboard?entityId=${dma!.id}`);
      expect(dmaDash.status()).toBe(403);

      const dmaCustomers = await yfz.get(`${API}/api/finance/customers?entityId=${dma!.id}`);
      expect(dmaCustomers.ok()).toBeTruthy();
      const list = (await dmaCustomers.json()) as unknown[];
      expect(Array.isArray(list) ? list.length : 1).toBe(0);
    } finally {
      await yfz.dispose();
      await ed.dispose();
    }

    await loginAs(page, 'fh.yfz@nfc.local');
    await page.goto('/finance/dashboard');
    await expect(page.getByRole('heading', { name: 'Position' })).toBeVisible();
    await expect(page.getByText('Live position for YFZ')).toBeVisible();
    await expect(page.getByText('Viewing YFZ')).toBeVisible();
  });
});
