import { expect, test, type APIRequestContext } from '@playwright/test';
import { YFZ_BANK_ACCOUNT_ID } from '@nfc/shared';
import { approveIfStatus, submitNeedApprovedProposal } from './procurement-flow';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function createSubmitted(
  gm: APIRequestContext,
  officer: APIRequestContext,
  md: APIRequestContext,
  proposed: 'before_delivery' | 'after_delivery',
  title = `M4 e2e ${unique('PR')}`,
) {
  return submitNeedApprovedProposal(gm, officer, md, { title, proposedPaymentTiming: proposed });
}

async function approve(
  actor: APIRequestContext,
  requestId: string,
  workflowId: string,
  extra: Record<string, unknown> = {},
) {
  const wf = (await (await actor.get(`${API}/api/workflows/${workflowId}`)).json()) as { rowVersion: number };
  return actor.post(`${API}/api/procurement/${requestId}/actions`, {
    headers: await csrfHeaders(actor),
    data: { action: 'APPROVE', rowVersion: wf.rowVersion, ...extra },
  });
}

test.describe('M4 payment execution', () => {
  test('before_delivery stays on the pay queue; after_delivery waits for GRN then pays', async ({ playwright }) => {
    test.setTimeout(120_000);
    const gm = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const finance = await playwright.request.newContext();
    const fh = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(finance, 'ed.finance@nfc.local');
      await apiLogin(fh, 'fh.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');

      const retain = await createSubmitted(gm, officer, md, 'before_delivery', `M4 retain ${unique('PR')}`);
      await approveIfStatus(ops, retain.id, retain.workflowInstanceId, 'AWAITING_OPERATIONS');
      await approveIfStatus(md, retain.id, retain.workflowInstanceId, 'AWAITING_MD');
      const retainedFin = await approve(finance, retain.id, retain.workflowInstanceId, {
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
        idempotencyKey: `e2e-m4-fin-retain-${retain.id}`,
      });
      expect(retainedFin.ok(), await retainedFin.text()).toBeTruthy();
      expect(((await retainedFin.json()) as { status: string }).status).toBe('AWAITING_PAYMENT');

      const after = await createSubmitted(gm, officer, md, 'before_delivery', `M4 after ${unique('PR')}`);
      await approveIfStatus(ops, after.id, after.workflowInstanceId, 'AWAITING_OPERATIONS');
      await approveIfStatus(md, after.id, after.workflowInstanceId, 'AWAITING_MD', {
        finalPaymentTiming: 'after_delivery',
      });
      const afterFin = await approve(finance, after.id, after.workflowInstanceId, {
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
        idempotencyKey: `e2e-m4-fin-after-${after.id}`,
      });
      expect(afterFin.ok(), await afterFin.text()).toBeTruthy();
      const queued = (await afterFin.json()) as {
        status: string;
        payableAmountKobo: number;
        entityId: string;
      };
      expect(queued.status).toBe('AWAITING_DELIVERY');
      expect(queued.payableAmountKobo).toBe(0);

      const earlyPay = await fh.post(`${API}/api/procurement/${after.id}/payments`, {
        headers: await csrfHeaders(fh),
        multipart: {
          payingAccountId: YFZ_BANK_ACCOUNT_ID,
          amountKobo: '200000',
          method: 'bank_transfer',
          bankReference: unique('EARLY'),
          paymentDate: '2026-10-03',
          idempotencyKey: unique('early-pay'),
          file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(earlyPay.status()).toBe(409);

      const upload = await gm.post(`${API}/api/documents`, {
        headers: await csrfHeaders(gm),
        multipart: {
          title: 'Completion certificate',
          category: 'completion_certificate',
          context: 'procurement',
          entityId: after.entityId,
          ownerType: 'procurement_request',
          ownerId: after.id,
          file: { name: 'cert.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(upload.ok(), await upload.text()).toBeTruthy();
      const cert = (await upload.json()) as { id: string };

      const grn = await officer.post(`${API}/api/procurement/${after.id}/receipts`, {
        headers: await csrfHeaders(officer),
        data: {
          receivedDate: '2026-10-03',
          location: 'YFZ mill stores',
          quantityReceived: 2,
          quantityAccepted: 2,
          idempotencyKey: unique('m4-grn'),
          documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
        },
      });
      expect(grn.ok(), await grn.text()).toBeTruthy();
      const received = (await grn.json()) as {
        status: string;
        payableAmountKobo: number;
        deliveryComplete: boolean;
        paymentComplete: boolean;
      };
      expect(received.status).toBe('AWAITING_PAYMENT');
      expect(received.deliveryComplete).toBe(true);
      expect(received.paymentComplete).toBe(false);
      expect(received.payableAmountKobo).toBe(200000);

      const paid = await fh.post(`${API}/api/procurement/${after.id}/payments`, {
        headers: await csrfHeaders(fh),
        multipart: {
          payingAccountId: YFZ_BANK_ACCOUNT_ID,
          amountKobo: '200000',
          method: 'bank_transfer',
          bankReference: unique('PAY'),
          paymentDate: '2026-10-03',
          idempotencyKey: unique('m4-pay'),
          file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(paid.ok(), await paid.text()).toBeTruthy();
      expect(((await paid.json()) as { status: string }).status).toBe('COMPLETED');
    } finally {
      await Promise.all([gm.dispose(), ops.dispose(), md.dispose(), finance.dispose(), fh.dispose(), officer.dispose()]);
    }
  });
});
