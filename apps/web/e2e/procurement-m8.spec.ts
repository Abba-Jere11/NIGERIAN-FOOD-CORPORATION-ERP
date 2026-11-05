import { expect, test } from '@playwright/test';
import { NFC_BANK_ACCOUNT_ID, YFZ_BANK_ACCOUNT_ID } from '@nfc/shared';
import { approveIfStatus, submitNeedApprovedProposal } from './procurement-flow';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('M8 procurement finance', () => {
  test('ED Finance approves route A; Finance Head pays; DMA Finance Head is refused', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const finance = await playwright.request.newContext();
    const fh = await playwright.request.newContext();
    const dmaFh = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(finance, 'ed.finance@nfc.local');
      await apiLogin(fh, 'fh.yfz@nfc.local');
      await apiLogin(dmaFh, 'fh.dma@nfc.local');

      const submitted = await submitNeedApprovedProposal(gm, officer, md, { title: `M8 e2e ${unique('PR')}` });
      await approveIfStatus(ops, submitted.id, submitted.workflowInstanceId, 'AWAITING_OPERATIONS', {
        idempotencyKey: `e2e-ops-${submitted.id}`,
      });
      const afterMd = await approveIfStatus(md, submitted.id, submitted.workflowInstanceId, 'AWAITING_MD', {
        idempotencyKey: `e2e-md-${submitted.id}`,
      });
      expect(afterMd.status).toBe('AWAITING_ED_FINANCE');

      const checks = await finance.get(`${API}/api/procurement/${submitted.id}/financial-checks`);
      expect(checks.ok()).toBeTruthy();
      const financeWf = (await (
        await finance.get(`${API}/api/workflows/${submitted.workflowInstanceId}`)
      ).json()) as { rowVersion: number };
      const approved = await finance.post(`${API}/api/procurement/${submitted.id}/actions`, {
        headers: await csrfHeaders(finance),
        data: {
          action: 'APPROVE',
          rowVersion: financeWf.rowVersion,
          fundingRoute: 'subsidiary_operating',
          sourceAccountId: YFZ_BANK_ACCOUNT_ID,
          checklistAcknowledged: true,
          idempotencyKey: `e2e-fin-${submitted.id}`,
        },
      });
      expect(approved.ok()).toBeTruthy();
      expect(((await approved.json()) as { status: string }).status).toBe('AWAITING_PAYMENT');

      const dmaPay = await dmaFh.post(`${API}/api/procurement/${submitted.id}/payments`, {
        headers: await csrfHeaders(dmaFh),
        multipart: {
          payingAccountId: YFZ_BANK_ACCOUNT_ID,
          amountKobo: '200000',
          method: 'bank_transfer',
          bankReference: unique('DMA'),
          paymentDate: '2026-10-03',
          idempotencyKey: unique('dma-pay'),
          file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect([403, 404]).toContain(dmaPay.status());

      const paid = await fh.post(`${API}/api/procurement/${submitted.id}/payments`, {
        headers: await csrfHeaders(fh),
        multipart: {
          payingAccountId: YFZ_BANK_ACCOUNT_ID,
          amountKobo: '200000',
          method: 'bank_transfer',
          bankReference: unique('PAY'),
          paymentDate: '2026-10-03',
          idempotencyKey: unique('yfz-pay'),
          file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(paid.ok()).toBeTruthy();
      const body = (await paid.json()) as { status: string; payments: Array<{ referenceNumber: string }> };
      expect(body.status).toBe('AWAITING_DELIVERY');
      expect(body.payments[0]?.referenceNumber).toMatch(/^PAY-/);
      void NFC_BANK_ACCOUNT_ID;
    } finally {
      await Promise.all([gm.dispose(), officer.dispose(), ops.dispose(), md.dispose(), finance.dispose(), fh.dispose(), dmaFh.dispose()]);
    }
  });
});
