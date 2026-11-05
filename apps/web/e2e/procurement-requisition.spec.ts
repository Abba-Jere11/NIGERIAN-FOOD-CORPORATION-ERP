import { expect, test } from '@playwright/test';
import { YFZ_REQUISITION_DRAFT_ID } from '@nfc/shared';
import { openNeedApprovedDraft, submitNeedApprovedProposal } from './procurement-flow';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('dual-approval requisition', () => {
  test('GM drafts a requisition without prices; MD need memo has no costs; officer autofills', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(md, 'md@nfc.local');

      const seeded = await gm.get(`${API}/api/requisitions/${YFZ_REQUISITION_DRAFT_ID}`);
      expect(seeded.ok(), await seeded.text()).toBeTruthy();

      const priced = await gm.post(`${API}/api/procurement`, {
        headers: await csrfHeaders(gm),
        data: { title: 'GM cannot price' },
      });
      expect([400, 403]).toContain(priced.status());

      const categories = (await (await gm.get(`${API}/api/procurement/categories`)).json()) as Array<{
        id: string;
        key: string;
      }>;
      const units = (await (await gm.get(`${API}/api/procurement/units`)).json()) as Array<{
        id: string;
        code: string;
      }>;
      const me = (await (await gm.get(`${API}/api/me`)).json()) as { entities: Array<{ id: string }> };
      const departments = (await (
        await gm.get(`${API}/api/entities/${me.entities[0]!.id}/departments`)
      ).json()) as Array<{ id: string }>;
      const created = await gm.post(`${API}/api/requisitions`, {
        headers: await csrfHeaders(gm),
        data: { title: `Need ${unique('REQ')}`, departmentId: departments[0]!.id },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const draft = (await created.json()) as { id: string; rowVersion: number };
      const saved = await gm.patch(`${API}/api/requisitions/${draft.id}`, {
        headers: await csrfHeaders(gm),
        data: {
          rowVersion: draft.rowVersion,
          title: 'Need without money',
          departmentId: departments[0]!.id,
          categoryId: categories.find((row) => row.key === 'services')!.id,
          background: 'Carry this background.',
          justification: 'Carry this justification.',
          prayer: 'Approve the need.',
          requiredDate: '2026-12-20',
          deliveryLocation: 'YFZ mill stores',
          lines: [
            {
              description: 'Need item',
              quantity: 3,
              unitId: units.find((row) => row.code === 'PCS')!.id,
            },
          ],
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      const money = await gm.patch(`${API}/api/requisitions/${draft.id}`, {
        headers: await csrfHeaders(gm),
        data: { rowVersion: (await saved.json() as { rowVersion: number }).rowVersion, unitPriceKobo: 1 },
      });
      expect(money.status()).toBe(400);

      const current = (await (await gm.get(`${API}/api/requisitions/${draft.id}`)).json()) as {
        rowVersion: number;
      };
      const submitted = await gm.post(`${API}/api/requisitions/${draft.id}/submit`, {
        headers: await csrfHeaders(gm),
        data: { rowVersion: current.rowVersion },
      });
      expect(submitted.ok(), await submitted.text()).toBeTruthy();
      const need = (await submitted.json()) as {
        procurementRequestId: string;
        workflowInstanceId: string;
        referenceNumber: string;
      };
      expect(need.referenceNumber).toMatch(/^REQ-/);

      const memo = await md.get(`${API}/api/requisitions/${draft.id}/memo`);
      expect(memo.ok()).toBeTruthy();
      const html = (await memo.json()) as { html: string };
      expect(html.html).toContain('Need item');
      expect(html.html).not.toMatch(/Naira/i);

      const shell = (await (await officer.get(`${API}/api/procurement/${need.procurementRequestId}`)).json()) as {
        title: string;
        description: string | null;
        reason: string | null;
        lines: Array<{ quantity: number; unitPriceKobo: number | null }>;
        totalAmountKobo: number;
      };
      expect(shell.title).toBe('Need without money');
      expect(shell.description).toContain('Carry this background');
      expect(shell.reason).toContain('Carry this justification');
      expect(shell.lines[0]?.quantity).toBe(3);
      expect(shell.lines[0]?.unitPriceKobo ?? 0).toBe(0);
      expect(shell.totalAmountKobo ?? 0).toBe(0);
    } finally {
      await gm.dispose();
      await officer.dispose();
      await md.dispose();
    }
  });

  test('services skip ED Operations; equipment hits it', async ({ playwright }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(md, 'md@nfc.local');

      const services = await submitNeedApprovedProposal(gm, officer, md, {
        title: `Skip ops ${unique('PR')}`,
        categoryKey: 'services',
      });
      expect(services.status).toBe('AWAITING_MD');

      const equipment = await submitNeedApprovedProposal(gm, officer, md, {
        title: `Hit ops ${unique('PR')}`,
        categoryKey: 'equipment',
      });
      expect(equipment.status).toBe('AWAITING_OPERATIONS');

      const draft = await openNeedApprovedDraft(gm, officer, md, { title: `Prepare ${unique('PR')}` });
      const view = (await (await officer.get(`${API}/api/procurement/${draft.id}`)).json()) as {
        status: string;
      };
      expect(view.status).toBe('AWAITING_PREPARATION');
    } finally {
      await gm.dispose();
      await officer.dispose();
      await md.dispose();
    }
  });
});
