import { expect, test, type APIRequestContext } from '@playwright/test';
import { YFZ_BANK_ACCOUNT_ID } from '@nfc/shared';
import { approveIfStatus, submitNeedApprovedProposal } from './procurement-flow';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DUE = '2026-12-15';

async function createSubmitted(
  gm: APIRequestContext,
  officer: APIRequestContext,
  md: APIRequestContext,
  title = `M6 e2e ${unique('PR')}`,
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

test.describe('M6 shortage deadline', () => {
  test('locks the second-batch date, lets MD correct it, and recovers prepaid value', async ({
    playwright,
  }) => {
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

      const submitted = await createSubmitted(gm, officer, md);
      await approveIfStatus(ops, submitted.id, submitted.workflowInstanceId, 'AWAITING_OPERATIONS');
      await approveIfStatus(md, submitted.id, submitted.workflowInstanceId, 'AWAITING_MD');
      const funded = await approve(finance, submitted.id, submitted.workflowInstanceId, {
        fundingRoute: 'subsidiary_operating',
        sourceAccountId: YFZ_BANK_ACCOUNT_ID,
        checklistAcknowledged: true,
        idempotencyKey: `e2e-m6-fin-${submitted.id}`,
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
          idempotencyKey: unique('m6-pay'),
          file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(paid.ok(), await paid.text()).toBeTruthy();

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

      const missingDate = await officer.post(`${API}/api/procurement/${submitted.id}/receipts`, {
        headers: await csrfHeaders(officer),
        data: {
          receivedDate: '2026-10-03',
          location: 'YFZ mill stores',
          quantityReceived: 1,
          quantityAccepted: 1,
          idempotencyKey: unique('m6-nodate'),
          documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
        },
      });
      expect(missingDate.status()).toBe(400);

      const partial = await officer.post(`${API}/api/procurement/${submitted.id}/receipts`, {
        headers: await csrfHeaders(officer),
        data: {
          receivedDate: '2026-10-03',
          location: 'YFZ mill stores',
          quantityReceived: 1,
          quantityAccepted: 1,
          secondBatchDueOn: DUE,
          idempotencyKey: unique('m6-grn'),
          documents: [{ documentId: cert.id, kind: 'completion_certificate' }],
        },
      });
      expect(partial.ok(), await partial.text()).toBeTruthy();
      const body = (await partial.json()) as {
        status: string;
        lines: Array<{ id: string; secondBatchDueOn: string | null }>;
      };
      expect(body.status).toBe('PARTIALLY_RECEIVED');
      expect(body.lines[0]?.secondBatchDueOn).toBe(DUE);

      const officerOverride = await officer.patch(`${API}/api/procurement/${submitted.id}/shortage-deadline`, {
        headers: await csrfHeaders(officer),
        data: { lineId: body.lines[0]!.id, dueOn: '2026-12-20', reason: 'Officer cannot.' },
      });
      expect(officerOverride.status()).toBe(403);

      const mdOverride = await md.patch(`${API}/api/procurement/${submitted.id}/shortage-deadline`, {
        headers: await csrfHeaders(md),
        data: {
          lineId: body.lines[0]!.id,
          dueOn: '2026-12-20',
          reason: 'Vendor confirmed a later shipment.',
        },
      });
      expect(mdOverride.ok(), await mdOverride.text()).toBeTruthy();
      expect(
        ((await mdOverride.json()) as { lines: Array<{ secondBatchDueOn: string | null }> }).lines[0]
          ?.secondBatchDueOn,
      ).toBe('2026-12-20');

      const close = await officer.post(`${API}/api/procurement/${submitted.id}/close-short`, {
        headers: await csrfHeaders(officer),
        data: { reason: 'Remainder will not arrive.' },
      });
      expect(close.ok(), await close.text()).toBeTruthy();
      const closeBody = (await close.json()) as {
        closeShort: { workflowInstanceId: string; vendorOpenClaim: { recoveryId: string | null } | null };
      };
      const closeWf = closeBody.closeShort.workflowInstanceId;
      const opsApprove = await ops.post(`${API}/api/workflows/${closeWf}/actions`, {
        headers: await csrfHeaders(ops),
        data: {
          action: 'APPROVE',
          rowVersion: ((await (await ops.get(`${API}/api/workflows/${closeWf}`)).json()) as { rowVersion: number })
            .rowVersion,
        },
      });
      expect(opsApprove.ok(), await opsApprove.text()).toBeTruthy();
      const finApprove = await finance.post(`${API}/api/workflows/${closeWf}/actions`, {
        headers: await csrfHeaders(finance),
        data: {
          action: 'APPROVE',
          rowVersion: (
            (await (await finance.get(`${API}/api/workflows/${closeWf}`)).json()) as { rowVersion: number }
          ).rowVersion,
        },
      });
      expect(finApprove.ok(), await finApprove.text()).toBeTruthy();

      const after = (await (await officer.get(`${API}/api/procurement/${submitted.id}`)).json()) as {
        closeShort: { vendorOpenClaim: { recoveryId: string | null; quantity: number } | null };
      };
      expect(after.closeShort.vendorOpenClaim?.quantity).toBe(1);
      expect(after.closeShort.vendorOpenClaim?.recoveryId).toBeTruthy();
    } finally {
      await Promise.all([gm.dispose(), ops.dispose(), md.dispose(), finance.dispose(), fh.dispose(), officer.dispose()]);
    }
  });
});
