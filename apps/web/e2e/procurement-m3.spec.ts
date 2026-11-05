import { expect, test, type APIRequestContext } from '@playwright/test';
import { XYZ_VENDOR_ID } from '@nfc/shared';
import { approveIfStatus, openNeedApprovedDraft, quoteAndAwardLowest } from './procurement-flow';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

async function refs(gm: APIRequestContext) {
  const categories = (await (await gm.get(`${API}/api/procurement/categories`)).json()) as Array<{
    id: string;
    key: string;
  }>;
  const units = (await (await gm.get(`${API}/api/procurement/units`)).json()) as Array<{ id: string; code: string }>;
  const funding = (await (await gm.get(`${API}/api/procurement/funding-sources`)).json()) as Array<{
    id: string;
    key: string;
  }>;
  const lines = (await (await gm.get(`${API}/api/budget-lines`)).json()) as Array<{ id: string; code: string }>;
  const me = (await (await gm.get(`${API}/api/me`)).json()) as { entities: Array<{ id: string }> };
  const departments = (await (
    await gm.get(`${API}/api/entities/${me.entities[0]!.id}/departments`)
  ).json()) as Array<{ id: string }>;
  return {
    departmentId: departments[0]!.id,
    servicesId: categories.find((row) => row.key === 'services')!.id,
    unitId: units.find((row) => row.code === 'PCS')!.id,
    fundingId: funding.find((row) => row.key === 'subsidiary_operating')!.id,
    budgetId: lines.find((row) => row.code === 'YFZ-CAPEX')!.id,
  };
}

async function quote(officer: APIRequestContext, id: string, totalKobo: number) {
  return quoteAndAwardLowest(officer, id, totalKobo);
}

test.describe('M3 multi-item lines', () => {
  test('submit needs a complete line; two lines sum; one-line and MD stay pay-then-deliver', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      const catalog = await refs(gm);
      const headers = await csrfHeaders(officer);

      const empty = await openNeedApprovedDraft(gm, officer, md, { title: `M3 empty ${unique('PR')}` });
      const refused = await officer.post(`${API}/api/procurement/${empty.id}/submit`, {
        headers,
        data: { rowVersion: empty.rowVersion, idempotencyKey: `e2e-m3-empty-${empty.id}` },
      });
      expect(refused.status()).toBe(400);
      expect(await refused.text()).toMatch(/Complete the request before submitting/);

      const opened = await openNeedApprovedDraft(gm, officer, md, { title: `M3 two ${unique('PR')}` });
      const saved = await officer.patch(`${API}/api/procurement/${opened.id}`, {
        headers,
        data: {
          rowVersion: opened.rowVersion,
          subject: 'M3 e2e',
          departmentId: catalog.departmentId,
          reason: 'E2E multi-item.',
          description: 'Two lines.',
          requiredDate: '2026-12-20',
          vendorId: XYZ_VENDOR_ID,
          deliveryLocation: 'YFZ mill stores',
          fundingSourceId: catalog.fundingId,
          urgency: 'NORMAL',
          proposedPaymentTiming: 'before_delivery',
          lines: [
            {
              description: 'Line A',
              categoryId: catalog.servicesId,
              quantity: 2,
              unitId: catalog.unitId,
              unitPriceKobo: 100000,
              budgetLineId: catalog.budgetId,
            },
            {
              description: 'Line B',
              categoryId: catalog.servicesId,
              quantity: 1,
              unitId: catalog.unitId,
              unitPriceKobo: 50000,
              budgetLineId: catalog.budgetId,
            },
          ],
        },
      });
      const afterSave = (await saved.json()) as {
        id: string;
        rowVersion: number;
        totalAmountKobo: number;
        lines: Array<{ lineNumber: number; description: string }>;
      };
      expect(afterSave.lines).toHaveLength(2);
      expect(afterSave.totalAmountKobo).toBe(250000);
      const quoted = await quote(officer, afterSave.id, afterSave.totalAmountKobo);

      const submitted = await officer.post(`${API}/api/procurement/${afterSave.id}/submit`, {
        headers,
        data: { rowVersion: quoted.rowVersion, idempotencyKey: `e2e-m3-${afterSave.id}` },
      });
      expect(submitted.ok(), await submitted.text()).toBeTruthy();
      const afterSubmit = (await submitted.json()) as {
        id: string;
        status: string;
        workflowInstanceId: string;
        lines: unknown[];
      };
      expect(afterSubmit.lines).toHaveLength(2);

      await approveIfStatus(ops, afterSubmit.id, afterSubmit.workflowInstanceId, 'AWAITING_OPERATIONS');
      const afterMd = await approveIfStatus(md, afterSubmit.id, afterSubmit.workflowInstanceId, 'AWAITING_MD');
      expect(afterMd.status).toBe('AWAITING_ED_FINANCE');

      const oneOpened = await openNeedApprovedDraft(gm, officer, md, { title: `M3 one ${unique('PR')}` });
      const oneSaved = await officer.patch(`${API}/api/procurement/${oneOpened.id}`, {
        headers,
        data: {
          rowVersion: oneOpened.rowVersion,
          subject: 'M3 one',
          departmentId: catalog.departmentId,
          reason: 'One line still works.',
          description: 'Single line.',
          requiredDate: '2026-12-20',
          vendorId: XYZ_VENDOR_ID,
          deliveryLocation: 'YFZ mill stores',
          fundingSourceId: catalog.fundingId,
          urgency: 'NORMAL',
          proposedPaymentTiming: 'before_delivery',
          lines: [
            {
              description: 'Single line.',
              categoryId: catalog.servicesId,
              quantity: 2,
              unitId: catalog.unitId,
              unitPriceKobo: 100000,
              budgetLineId: catalog.budgetId,
            },
          ],
        },
      });
      const oneAfter = (await oneSaved.json()) as { id: string; rowVersion: number; lines: unknown[] };
      const oneQuoted = await quote(officer, oneAfter.id, 200000);
      const oneSubmit = await officer.post(`${API}/api/procurement/${oneAfter.id}/submit`, {
        headers,
        data: { rowVersion: oneQuoted.rowVersion, idempotencyKey: `e2e-m3-one-${oneAfter.id}` },
      });
      expect(oneSubmit.ok(), await oneSubmit.text()).toBeTruthy();
      expect(((await oneSubmit.json()) as { lines: unknown[] }).lines).toHaveLength(1);
    } finally {
      await Promise.all([gm.dispose(), officer.dispose(), ops.dispose(), md.dispose()]);
    }
  });
});
