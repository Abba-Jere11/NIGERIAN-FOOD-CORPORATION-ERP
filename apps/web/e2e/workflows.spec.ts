import { PROCUREMENT_WORKFLOW_KEY } from '@nfc/shared';
import { expect, test } from '@playwright/test';
import { apiLogin, csrfHeaders, loginAs } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

interface WorkflowBody {
  id: string;
  status: string;
  currentStageKey: string | null;
  subjectVersion: number;
  rowVersion: number;
  history: unknown[];
  allowedActions: string[];
  seals: Array<{ badgeLabel: string }>;
}

test.describe('M4 approval engine', () => {
  test('approve, return, resubmit and archive match the worked example', async ({ playwright }) => {
    const gm = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');

      const created = await gm.post(`${API}/api/workflows/demo`, {
        headers: await csrfHeaders(gm),
        data: { title: 'Milling machine fixture run', definitionKey: PROCUREMENT_WORKFLOW_KEY },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      let instance = (await created.json()) as WorkflowBody;
      expect(instance.currentStageKey).toBe('ed-operations');
      expect(instance.history).toHaveLength(0);
      expect(instance.seals.some((seal) => seal.badgeLabel === 'REQUESTED BY')).toBeTruthy();

      const self = await gm.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(gm),
        data: { action: 'APPROVE', rowVersion: instance.rowVersion },
      });
      expect(self.status()).toBe(403);

      const approved = await ops.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(ops),
        data: { action: 'APPROVE', rowVersion: instance.rowVersion },
      });
      expect(approved.ok(), await approved.text()).toBeTruthy();
      instance = (await approved.json()) as WorkflowBody;
      expect(instance.currentStageKey).toBe('md');
      expect(instance.seals.some((seal) => seal.badgeLabel === 'FINANCE APPROVED')).toBeTruthy();

      const noReason = await md.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(md),
        data: { action: 'RETURN_FOR_CORRECTION', rowVersion: instance.rowVersion },
      });
      expect(noReason.status()).toBe(400);

      const returned = await md.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(md),
        data: {
          action: 'RETURN_FOR_CORRECTION',
          reason: 'Add a comparative quote from a second vendor.',
          rowVersion: instance.rowVersion,
        },
      });
      expect(returned.ok(), await returned.text()).toBeTruthy();
      instance = (await returned.json()) as WorkflowBody;
      expect(instance.status).toBe('DRAFT');
      expect(instance.subjectVersion).toBe(2);
      const asOriginator = (await (await gm.get(`${API}/api/workflows/${instance.id}`)).json()) as WorkflowBody;
      expect(asOriginator.allowedActions).toContain('RESUBMIT');
      expect(instance.seals.some((seal) => seal.badgeLabel === 'RETURNED FOR CORRECTION')).toBeTruthy();

      const pendingOps = (await (await ops.get(`${API}/api/workflows/pending`)).json()) as Array<{
        id: string;
      }>;
      expect(pendingOps.some((row) => row.id === instance.id)).toBeFalsy();
      const pendingGm = (await (await gm.get(`${API}/api/workflows/pending`)).json()) as Array<{
        id: string;
      }>;
      expect(pendingGm.some((row) => row.id === instance.id)).toBeTruthy();

      const resubmitted = await gm.post(`${API}/api/workflows/${instance.id}/resubmit`, {
        headers: await csrfHeaders(gm),
        data: { rowVersion: instance.rowVersion },
      });
      expect(resubmitted.ok(), await resubmitted.text()).toBeTruthy();
      instance = (await resubmitted.json()) as WorkflowBody;
      expect(instance.status).toBe('IN_PROGRESS');
      expect(instance.currentStageKey).toBe('ed-operations');
      expect(instance.subjectVersion).toBe(2);

      const adminArchive = await admin.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(admin),
        data: {
          action: 'ARCHIVE',
          reason: 'Administrator must not archive.',
          rowVersion: instance.rowVersion,
        },
      });
      expect([403, 404]).toContain(adminArchive.status());

      const archived = await md.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(md),
        data: {
          action: 'ARCHIVE',
          reason: 'Parked before payment while quotes are collected.',
          rowVersion: instance.rowVersion,
        },
      });
      expect(archived.ok(), await archived.text()).toBeTruthy();
      instance = (await archived.json()) as WorkflowBody;
      expect(instance.status).toBe('ARCHIVED');
    } finally {
      await Promise.all([gm.dispose(), ops.dispose(), md.dispose(), admin.dispose()]);
    }
  });

  test('concurrent double-approve produces one action', async ({ playwright }) => {
    const gm = await playwright.request.newContext();
    const opsA = await playwright.request.newContext();
    const opsB = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(opsA, 'ed.operations@nfc.local');
      await apiLogin(opsB, 'ed.operations@nfc.local');
      const created = await gm.post(`${API}/api/workflows/demo`, {
        headers: await csrfHeaders(gm),
        data: { title: 'Concurrent approve', definitionKey: PROCUREMENT_WORKFLOW_KEY },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const instance = (await created.json()) as WorkflowBody;
      const [first, second] = await Promise.all([
        opsA.post(`${API}/api/workflows/${instance.id}/actions`, {
          headers: await csrfHeaders(opsA),
          data: { action: 'APPROVE', rowVersion: instance.rowVersion },
        }),
        opsB.post(`${API}/api/workflows/${instance.id}/actions`, {
          headers: await csrfHeaders(opsB),
          data: { action: 'APPROVE', rowVersion: instance.rowVersion },
        }),
      ]);
      const winner = first.ok() ? first : second;
      const loser = first.ok() ? second : first;
      expect(winner.ok(), await winner.text()).toBeTruthy();
      expect(loser.ok()).toBeFalsy();
      const body = (await winner.json()) as WorkflowBody;
      expect(body.history).toHaveLength(1);
      expect(body.currentStageKey).toBe('md');
    } finally {
      await Promise.all([gm.dispose(), opsA.dispose(), opsB.dispose()]);
    }
  });

  test('seal badge labels are visually distinct on the design page', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await page.goto('/design');
    for (const label of [
      'REQUESTED BY',
      'NEED APPROVED',
      'PREPARED BY',
      'FINANCE APPROVED',
      'REJECTED',
      'RETURNED FOR CORRECTION',
      'PAID BY',
      'DELIVERY VERIFIED BY',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });
});
