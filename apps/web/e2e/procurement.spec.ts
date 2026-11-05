import { expect, test } from '@playwright/test';
import { SAHEL_VENDOR_ID, YFZ_PROCUREMENT_DRAFT_ID } from '@nfc/shared';
import { openNeedApprovedDraft, submitNeedApprovedProposal } from './procurement-flow';
import { apiLogin, csrfHeaders } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M6 procurement', () => {
  test('GM YFZ sees the seeded draft; GM DMA cannot', async ({ playwright }) => {
    const yfz = await playwright.request.newContext();
    const dma = await playwright.request.newContext();
    try {
      await apiLogin(yfz, 'gm.yfz@nfc.local');
      await apiLogin(dma, 'gm.dma@nfc.local');

      const list = (await (await yfz.get(`${API}/api/procurement`)).json()) as {
        items: Array<{ id: string; referenceNumber: string }>;
      };
      expect(list.items.some((row) => row.referenceNumber === 'PR-2026-000186')).toBeTruthy();

      const own = await yfz.get(`${API}/api/procurement/${YFZ_PROCUREMENT_DRAFT_ID}`);
      expect(own.ok()).toBeTruthy();

      const hidden = await dma.get(`${API}/api/procurement/${YFZ_PROCUREMENT_DRAFT_ID}`);
      expect(hidden.status()).toBe(404);
    } finally {
      await yfz.dispose();
      await dma.dispose();
    }
  });

  test('happy path dual-approval submit and Sahel vendor rejection', async ({ playwright }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');

      const refused = await admin.post(`${API}/api/procurement`, {
        headers: await csrfHeaders(admin),
        data: { title: 'Admin should fail' },
      });
      expect(refused.status()).toBe(403);

      const gmCreate = await gm.post(`${API}/api/procurement`, {
        headers: await csrfHeaders(gm),
        data: { title: 'GM priced PR' },
      });
      expect([400, 403]).toContain(gmCreate.status());

      const submitted = await submitNeedApprovedProposal(gm, officer, md, {
        title: 'E2E structured request',
        quantity: 2,
        unitPriceKobo: 125_000,
      });
      expect(submitted.status).toBe('AWAITING_MD');
      expect(submitted.workflowInstanceId).toBeTruthy();

      const view = (await (await gm.get(`${API}/api/procurement/${submitted.id}`)).json()) as {
        totalAmountKobo: number;
      };
      expect(view.totalAmountKobo).toBe(250000);

      const instance = (await (await gm.get(`${API}/api/workflows/${submitted.workflowInstanceId}`)).json()) as {
        currentStageKey: string | null;
        seals: Array<{ badgeLabel: string; verification: string }>;
      };
      expect(instance.currentStageKey).toBe('md');
      expect(
        instance.seals.some((seal) => seal.badgeLabel === 'REQUESTED BY' && seal.verification === 'VALID'),
      ).toBeTruthy();
      expect(
        instance.seals.some((seal) => seal.badgeLabel === 'NEED APPROVED' && seal.verification === 'VALID'),
      ).toBeTruthy();
      expect(
        instance.seals.some((seal) => seal.badgeLabel === 'PREPARED BY' && seal.verification === 'VALID'),
      ).toBeTruthy();

      const memo = await gm.get(`${API}/api/procurement/${submitted.id}/memo`);
      expect(memo.ok()).toBeTruthy();
      const html = (await memo.json()) as { html: string };
      expect(html.html).toMatch(/Two Thousand, Five Hundred Naira Only/i);

      const sahelDraft = await openNeedApprovedDraft(gm, officer, md, {
        title: 'Sahel vendor rejection',
      });
      const sahel = await officer.patch(`${API}/api/procurement/${sahelDraft.id}`, {
        headers: await csrfHeaders(officer),
        data: { rowVersion: sahelDraft.rowVersion, vendorId: SAHEL_VENDOR_ID },
      });
      expect(sahel.status()).toBe(400);
    } finally {
      await gm.dispose();
      await officer.dispose();
      await md.dispose();
      await admin.dispose();
    }
  });
});
