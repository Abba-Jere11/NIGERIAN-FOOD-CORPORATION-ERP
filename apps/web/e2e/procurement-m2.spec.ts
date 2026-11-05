import { expect, test, type APIRequestContext } from '@playwright/test';
import { XYZ_VENDOR_ID } from '@nfc/shared';
import { approveIfStatus, openNeedApprovedDraft, quoteAndAwardLowest } from './procurement-flow';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

async function createDraft(
  gm: APIRequestContext,
  officer: APIRequestContext,
  md: APIRequestContext,
  withTiming = true,
) {
  const opened = await openNeedApprovedDraft(gm, officer, md, { title: `M2 e2e ${unique('PR')}` });
  const headers = await csrfHeaders(officer);
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
  const saved = await officer.patch(`${API}/api/procurement/${opened.id}`, {
    headers,
    data: {
      rowVersion: opened.rowVersion,
      subject: 'M2 e2e',
      departmentId: departments[0]!.id,
      reason: 'E2E payment timing.',
      description: 'Structured line.',
      requiredDate: '2026-12-20',
      vendorId: XYZ_VENDOR_ID,
      deliveryLocation: 'YFZ mill stores',
      fundingSourceId: funding.find((row) => row.key === 'subsidiary_operating')!.id,
      lines: [
        {
          description: 'Structured line.',
          categoryId: categories.find((row) => row.key === 'services')!.id,
          quantity: 2,
          unitId: units.find((row) => row.code === 'PCS')!.id,
          unitPriceKobo: 100000,
          budgetLineId: lines.find((row) => row.code === 'YFZ-CAPEX')!.id,
        },
      ],
      urgency: 'NORMAL',
      ...(withTiming ? { proposedPaymentTiming: 'before_delivery' } : {}),
    },
  });
  const afterSave = (await saved.json()) as {
    id: string;
    rowVersion: number;
    proposedPaymentTiming: string | null;
  };
  const quoted = await quoteAndAwardLowest(officer, opened.id, 200000);
  return { headers, afterSave: { ...afterSave, rowVersion: quoted.rowVersion } };
}

test.describe('M2 payment timing', () => {
  test('submit requires proposed timing; MD retain and flip keep the pay-then-deliver queue', async ({
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

      const missing = await createDraft(gm, officer, md, false);
      const refused = await officer.post(`${API}/api/procurement/${missing.afterSave.id}/submit`, {
        headers: missing.headers,
        data: { rowVersion: missing.afterSave.rowVersion, idempotencyKey: `e2e-m2-missing-${missing.afterSave.id}` },
      });
      expect(refused.status()).toBe(400);
      expect(await refused.text()).toMatch(/proposed payment timing/);

      const retainDraft = await createDraft(gm, officer, md);
      const retainedSubmit = await officer.post(`${API}/api/procurement/${retainDraft.afterSave.id}/submit`, {
        headers: retainDraft.headers,
        data: {
          rowVersion: retainDraft.afterSave.rowVersion,
          idempotencyKey: `e2e-m2-retain-${retainDraft.afterSave.id}`,
        },
      });
      expect(retainedSubmit.ok(), await retainedSubmit.text()).toBeTruthy();
      const retained = (await retainedSubmit.json()) as {
        id: string;
        workflowInstanceId: string;
        status: string;
      };
      await approveIfStatus(ops, retained.id, retained.workflowInstanceId, 'AWAITING_OPERATIONS');
      const afterMd = await approveIfStatus(md, retained.id, retained.workflowInstanceId, 'AWAITING_MD');
      expect(afterMd.status).toBe('AWAITING_ED_FINANCE');
      const retainedBody = (await (await md.get(`${API}/api/procurement/${retained.id}`)).json()) as {
        status: string;
        proposedPaymentTiming: string;
        finalPaymentTiming: string;
      };
      expect(retainedBody.proposedPaymentTiming).toBe('before_delivery');
      expect(retainedBody.finalPaymentTiming).toBe('before_delivery');

      const flipDraft = await createDraft(gm, officer, md);
      const flipSubmit = await officer.post(`${API}/api/procurement/${flipDraft.afterSave.id}/submit`, {
        headers: flipDraft.headers,
        data: {
          rowVersion: flipDraft.afterSave.rowVersion,
          idempotencyKey: `e2e-m2-flip-${flipDraft.afterSave.id}`,
        },
      });
      const flipped = (await flipSubmit.json()) as { id: string; workflowInstanceId: string };
      await approveIfStatus(ops, flipped.id, flipped.workflowInstanceId, 'AWAITING_OPERATIONS');
      const flipMd = await approveIfStatus(md, flipped.id, flipped.workflowInstanceId, 'AWAITING_MD', {
        finalPaymentTiming: 'after_delivery',
      });
      expect(flipMd.status).toBe('AWAITING_ED_FINANCE');
      const flipBody = (await (await md.get(`${API}/api/procurement/${flipped.id}`)).json()) as {
        finalPaymentTiming: string;
      };
      expect(flipBody.finalPaymentTiming).toBe('after_delivery');
    } finally {
      await Promise.all([gm.dispose(), officer.dispose(), ops.dispose(), md.dispose()]);
    }
  });
});
