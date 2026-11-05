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
  title = `M9 e2e ${unique('PR')}`,
) {
  return submitNeedApprovedProposal(gm, officer, md, { title });
}

async function approve(actor: APIRequestContext, requestId: string, workflowId: string, extra: Record<string, unknown> = {}) {
  const wf = (await (await actor.get(`${API}/api/workflows/${workflowId}`)).json()) as { rowVersion: number };
  return actor.post(`${API}/api/procurement/${requestId}/actions`, {
    headers: await csrfHeaders(actor),
    data: { action: 'APPROVE', rowVersion: wf.rowVersion, ...extra },
  });
}

test.describe('M9 procurement delivery', () => {
  test('create → approve → pay → deliver → complete; return and reject still work before money moves', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const finance = await playwright.request.newContext();
    const fh = await playwright.request.newContext();
    const dma = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(finance, 'ed.finance@nfc.local');
      await apiLogin(fh, 'fh.yfz@nfc.local');
      await apiLogin(dma, 'gm.dma@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');

      const toReturn = await createSubmitted(gm, officer, md, `M9 return ${unique('PR')}`);
      const returned = await md.post(`${API}/api/procurement/${toReturn.id}/actions`, {
        headers: await csrfHeaders(md),
        data: {
          action: 'RETURN_FOR_CORRECTION',
          reason: 'Need a clearer specification.',
          rowVersion: ((await (await md.get(`${API}/api/workflows/${toReturn.workflowInstanceId}`)).json()) as { rowVersion: number }).rowVersion,
        },
      });
      expect(returned.ok(), await returned.text()).toBeTruthy();
      expect(((await returned.json()) as { status: string }).status).toBe('DRAFT');

      const toReject = await createSubmitted(gm, officer, md, `M9 reject ${unique('PR')}`);
      await approveIfStatus(ops, toReject.id, toReject.workflowInstanceId, 'AWAITING_OPERATIONS');
      const rejected = await md.post(`${API}/api/procurement/${toReject.id}/actions`, {
        headers: await csrfHeaders(md),
        data: {
          action: 'REJECT',
          reason: 'Not required this year.',
          rowVersion: ((await (await md.get(`${API}/api/workflows/${toReject.workflowInstanceId}`)).json()) as { rowVersion: number }).rowVersion,
        },
      });
      expect(rejected.ok()).toBeTruthy();
      expect(((await rejected.json()) as { status: string }).status).toBe('REJECTED');

      const submitted = await createSubmitted(gm, officer, md);
      await approveIfStatus(ops, submitted.id, submitted.workflowInstanceId, 'AWAITING_OPERATIONS');
      await approveIfStatus(md, submitted.id, submitted.workflowInstanceId, 'AWAITING_MD');
      const funded = await approve(finance, submitted.id, submitted.workflowInstanceId, {
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
        idempotencyKey: `e2e-fin-${submitted.id}`,
      });
      expect(funded.ok(), await funded.text()).toBeTruthy();

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
      expect(paid.ok(), await paid.text()).toBeTruthy();
      expect(((await paid.json()) as { status: string }).status).toBe('AWAITING_DELIVERY');

      const upload = await gm.post(`${API}/api/documents`, {
        headers: await csrfHeaders(gm),
        multipart: {
          title: 'Completion certificate',
          category: 'completion_certificate',
          context: 'procurement',
          entityId: submitted.entityId,
          ownerType: 'procurement_request',
          ownerId: submitted.id,
          file: { name: 'cert.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(upload.ok(), await upload.text()).toBeTruthy();
      const cert = (await upload.json()) as { id: string };

      const dmaGrn = await dma.post(`${API}/api/procurement/${submitted.id}/receipts`, {
        headers: await csrfHeaders(dma),
        data: {
          receivedDate: '2026-10-03',
          location: 'DMA',
          quantityReceived: 2,
          quantityAccepted: 2,
          idempotencyKey: unique('dma-grn'),
          documents: [],
        },
      });
      expect([403, 404]).toContain(dmaGrn.status());

      const adminGrn = await admin.post(`${API}/api/procurement/${submitted.id}/receipts`, {
        headers: await csrfHeaders(admin),
        data: {
          receivedDate: '2026-10-03',
          location: 'Admin',
          quantityReceived: 2,
          quantityAccepted: 2,
          idempotencyKey: unique('admin-grn'),
          documents: [],
        },
      });
      expect(adminGrn.status()).toBe(403);

      const gmGrn = await gm.post(`${API}/api/procurement/${submitted.id}/receipts`, {
        headers: await csrfHeaders(gm),
        data: {
          receivedDate: '2026-10-03',
          location: 'YFZ mill stores',
          quantityReceived: 2,
          quantityAccepted: 2,
          idempotencyKey: unique('gm-grn'),
          documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
        },
      });
      expect(gmGrn.status()).toBe(403);

      const completed = await officer.post(`${API}/api/procurement/${submitted.id}/receipts`, {
        headers: await csrfHeaders(officer),
        data: {
          receivedDate: '2026-10-03',
          location: 'YFZ mill stores',
          quantityReceived: 2,
          quantityAccepted: 2,
          idempotencyKey: unique('grn'),
          documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
        },
      });
      expect(completed.ok(), await completed.text()).toBeTruthy();
      const body = (await completed.json()) as { status: string; receipts: Array<{ referenceNumber: string }> };
      expect(body.status).toBe('COMPLETED');
      expect(body.receipts[0]?.referenceNumber).toMatch(/^GRN-/);
    } finally {
      await Promise.all([
        gm.dispose(),
        ops.dispose(),
        md.dispose(),
        finance.dispose(),
        fh.dispose(),
        dma.dispose(),
        admin.dispose(),
        officer.dispose(),
      ]);
    }
  });
});
