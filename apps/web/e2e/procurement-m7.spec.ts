import { expect, test } from '@playwright/test';
import { submitNeedApprovedProposal } from './procurement-flow';
import { apiLogin, csrfHeaders } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M7 procurement approvals', () => {
  test('Ops approves on the procurement record; MD cannot act at Ops', async ({ playwright }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');

      const submitted = await submitNeedApprovedProposal(gm, officer, md, {
        title: 'M7 e2e equipment',
        categoryKey: 'equipment',
      });
      expect(submitted.status).toBe('AWAITING_OPERATIONS');
      const workflow = (await (await ops.get(`${API}/api/workflows/${submitted.workflowInstanceId}`)).json()) as {
        rowVersion: number;
        allowedActions: string[];
        currentStageKey: string;
      };
      expect(workflow.currentStageKey).toBe('ed-operations');
      expect(workflow.allowedActions).toContain('APPROVE');

      const mdBlocked = await md.post(`${API}/api/procurement/${submitted.id}/actions`, {
        headers: await csrfHeaders(md),
        data: { action: 'APPROVE', rowVersion: workflow.rowVersion },
      });
      expect(mdBlocked.status()).toBe(403);

      const approved = await ops.post(`${API}/api/procurement/${submitted.id}/actions`, {
        headers: await csrfHeaders(ops),
        data: { action: 'APPROVE', rowVersion: workflow.rowVersion },
      });
      expect(approved.ok(), await approved.text()).toBeTruthy();
      expect(((await approved.json()) as { status: string }).status).toBe('AWAITING_MD');
    } finally {
      await gm.dispose();
      await officer.dispose();
      await ops.dispose();
      await md.dispose();
    }
  });

  test('return creates version 2; officer resubmits; reject can be cloned', async ({ playwright }) => {
    const gm = await playwright.request.newContext();
    const officer = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(officer, 'inventory@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      const submitted = await submitNeedApprovedProposal(gm, officer, md, {
        title: 'M7 return',
        categoryKey: 'equipment',
      });
      const workflow = (await (await ops.get(`${API}/api/workflows/${submitted.workflowInstanceId}`)).json()) as {
        rowVersion: number;
      };
      const returned = await ops.post(`${API}/api/procurement/${submitted.id}/actions`, {
        headers: await csrfHeaders(ops),
        data: {
          action: 'RETURN_FOR_CORRECTION',
          reason: 'Add the comparative quotation.',
          rowVersion: workflow.rowVersion,
        },
      });
      expect(returned.ok(), await returned.text()).toBeTruthy();
      const body = (await returned.json()) as {
        status: string;
        currentVersion: number;
        lastReturnReason: string | null;
        rowVersion: number;
      };
      expect(body.status).toBe('DRAFT');
      expect(body.currentVersion).toBe(2);
      expect(body.lastReturnReason).toMatch(/comparative quotation/);

      // Quotations carry over to version 2; the award is still the lowest price.
      const v2 = (await (await officer.get(`${API}/api/procurement/${submitted.id}`)).json()) as {
        rowVersion: number;
        quotationComparison: { pricedCount: number; selectionIsRecommended: boolean };
      };
      expect(v2.quotationComparison.pricedCount).toBe(2);
      expect(v2.quotationComparison.selectionIsRecommended).toBe(true);
      const afterQuote = { rowVersion: v2.rowVersion };
      const resubmitted = await officer.post(`${API}/api/procurement/${submitted.id}/submit`, {
        headers: await csrfHeaders(officer),
        data: { rowVersion: afterQuote.rowVersion, idempotencyKey: `e2e-m7-${submitted.id}-v2` },
      });
      expect(resubmitted.ok(), await resubmitted.text()).toBeTruthy();
      expect(((await resubmitted.json()) as { status: string }).status).toBe('AWAITING_OPERATIONS');

      const second = await submitNeedApprovedProposal(gm, officer, md, {
        title: 'M7 clone',
        categoryKey: 'equipment',
      });
      const secondWf = (await (await ops.get(`${API}/api/workflows/${second.workflowInstanceId}`)).json()) as {
        rowVersion: number;
      };
      const rejected = await ops.post(`${API}/api/procurement/${second.id}/actions`, {
        headers: await csrfHeaders(ops),
        data: { action: 'REJECT', reason: 'Not in the mill package.', rowVersion: secondWf.rowVersion },
      });
      expect(rejected.ok()).toBeTruthy();
      const cloned = await officer.post(`${API}/api/procurement/${second.id}/clone`, {
        headers: await csrfHeaders(officer),
        data: {},
      });
      expect(cloned.ok(), await cloned.text()).toBeTruthy();
      const cloneBody = (await cloned.json()) as { status: string; clonedFromId: string | null };
      expect(cloneBody.status).toBe('DRAFT');
      expect(cloneBody.clonedFromId).toBe(second.id);
    } finally {
      await gm.dispose();
      await officer.dispose();
      await ops.dispose();
      await md.dispose();
    }
  });
});
