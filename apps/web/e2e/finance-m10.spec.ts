import { expect, test } from '@playwright/test';
import { YFZ_BUDGET_2026_ID, YFZ_PENDING_JOURNAL_ID, YFZ_POSTED_JOURNAL_ID } from '@nfc/shared';
import { apiLogin, csrfHeaders, loginAs } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M10 finance', () => {
  test('ED Finance can open journals, the chart and trial balance', async ({ page }) => {
    await loginAs(page, 'ed.finance@nfc.local');
    await page.goto('/finance/journals');
    await expect(page.getByRole('heading', { name: 'Journals' })).toBeVisible();
    await expect(page.getByText('JNL-2026-000001')).toBeVisible();
    await expect(page.getByText('JNL-2026-000002')).toBeVisible();
    await page.goto('/finance/coa');
    await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible();
    await expect(page.getByText('Bank — operating').first()).toBeVisible();
    await page.goto('/finance/trial-balance');
    await expect(page.getByRole('heading', { name: 'Trial balance' })).toBeVisible();
    await page.goto('/finance/budgets');
    await expect(page.getByText('BUD-2026-').first()).toBeVisible();
    await page.goto('/budget-lines');
    await expect(page).toHaveURL(/\/finance\/budgets/);
  });

  test('YFZ Finance Head cannot read DMA finance APIs', async ({ playwright }) => {
    const yfz = await playwright.request.newContext();
    const ed = await playwright.request.newContext();
    try {
      await apiLogin(yfz, 'fh.yfz@nfc.local');
      await apiLogin(ed, 'ed.finance@nfc.local');
      const headers = await csrfHeaders(ed);
      void headers;
      const contextRes = await yfz.get(`${API}/api/finance/context`);
      expect(contextRes.ok(), await contextRes.text()).toBeTruthy();
      const context = (await contextRes.json()) as {
        canConsolidate: boolean;
        entities: Array<{ code: string }>;
      };
      expect(context.canConsolidate).toBeFalsy();
      expect(context.entities.some((entity) => entity.code === 'DMA')).toBeFalsy();

      const dmaYears = await yfz.get(`${API}/api/finance/years`);
      expect(dmaYears.ok()).toBeTruthy();
      const years = (await dmaYears.json()) as Array<{ entityCode: string }>;
      expect(years.every((row) => row.entityCode !== 'DMA')).toBeTruthy();

      const posted = await yfz.get(`${API}/api/finance/journals/${YFZ_POSTED_JOURNAL_ID}`);
      expect(posted.ok()).toBeTruthy();

      const edEntities = (await (await ed.get(`${API}/api/finance/context`)).json()) as {
        entities: Array<{ id: string; code: string }>;
      };
      const dma = edEntities.entities.find((entity) => entity.code === 'DMA');
      expect(dma).toBeTruthy();
      const dmaAccounts = await yfz.get(`${API}/api/finance/accounts?entityId=${dma!.id}`);
      const dmaList = (await dmaAccounts.json()) as unknown[];
      expect(Array.isArray(dmaList) ? dmaList.length : 1).toBe(0);

      const budget = await yfz.get(`${API}/api/finance/budgets/${YFZ_BUDGET_2026_ID}`);
      expect(budget.ok()).toBeTruthy();
      const pending = await yfz.get(`${API}/api/finance/journals/${YFZ_PENDING_JOURNAL_ID}`);
      expect(pending.ok()).toBeTruthy();
    } finally {
      await yfz.dispose();
      await ed.dispose();
    }
  });

  test('trial balance totals match and the home queue is live', async ({ playwright, page }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'ed.finance@nfc.local');
      const trialRes = await api.get(`${API}/api/finance/trial-balance?consolidated=true`);
      expect(trialRes.ok(), await trialRes.text()).toBeTruthy();
      const trial = (await trialRes.json()) as {
        debitTotalKobo: number;
        creditTotalKobo: number;
      };
      expect(trial.debitTotalKobo).toBe(trial.creditTotalKobo);
      const queuesRes = await api.get(`${API}/api/finance/queues`);
      expect(queuesRes.ok(), await queuesRes.text()).toBeTruthy();
      const queues = (await queuesRes.json()) as {
        pendingJournals: number;
        unreconciledLines: number;
      };
      expect(queues.pendingJournals).toBeGreaterThan(0);
      expect(queues.unreconciledLines).toBeGreaterThan(0);
    } finally {
      await api.dispose();
    }
    await loginAs(page, 'ed.finance@nfc.local');
    await expect(page.getByText('Journals to approve')).toBeVisible();
  });
});
