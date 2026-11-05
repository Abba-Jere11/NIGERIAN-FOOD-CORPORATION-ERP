import { expect, test, type APIRequestContext } from '@playwright/test';
import { ROLE_KEYS } from '@nfc/shared';
import { apiLogin, csrfHeaders, loginAs, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

async function meOf(request: APIRequestContext) {
  return (await (await request.get(`${API}/api/me`)).json()) as {
    ref: string;
    entities: Array<{ id: string; code: string }>;
    permissions: string[];
  };
}

test.describe('M16 official reports', () => {
  test('Official reports is distinct from operational Reports and has no HOD', async ({ page }) => {
    expect([...ROLE_KEYS]).not.toContain('hod');
    await loginAs(page, 'gm.yfz@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Official reports', { exact: true })).toBeVisible();
    await expect(nav.getByText('Reports', { exact: true })).toBeVisible();
    await expect(nav.getByText(/HOD/i)).toHaveCount(0);
    await nav.getByText('Official reports', { exact: true }).click();
    await expect(page).toHaveURL(/\/org-reports$/);
    await expect(page.getByRole('heading', { name: 'Official reports' })).toBeVisible();
    await expect(page.getByText(/HOD/i)).toHaveCount(0);
  });

  test('GM submits a general report; MD opens it; others cannot', async ({ page, playwright }) => {
    await loginAs(page, 'gm.yfz@nfc.local');
    await page.goto('/org-reports/new');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('No body yet.')).toBeVisible();
    const title = unique('M16 general');
    await page.locator('select[name="templateKey"]').selectOption('general');
    await page.locator('select[name="entityId"]').selectOption({ index: 1 });
    await expect(page.locator('select[name="templateKey"]')).toHaveValue('general');
    await page.getByRole('textbox', { name: 'Report title' }).fill(title);
    await page.getByRole('textbox', { name: 'Report body' }).fill('Weekly narrative to the Managing Director. No CC.');
    await page.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('Report submitted')).toBeVisible();
    await expect(page.getByText(/Reference ORG-\d{4}-\d{6} was submitted/)).toBeVisible();
    const id = page.url().split('/org-reports/')[1]?.split('?')[0];
    expect(id).toBeTruthy();

    const md = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const dma = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(dma, 'gm.dma@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');
      expect((await md.get(`${API}/api/org-reports/${id}`)).ok()).toBeTruthy();
      expect((await ops.get(`${API}/api/org-reports/${id}`)).status()).toBe(404);
      expect((await dma.get(`${API}/api/org-reports/${id}`)).status()).toBe(404);
      expect((await admin.get(`${API}/api/org-reports/${id}`)).status()).toBe(404);
      expect(
        (
          await admin.post(`${API}/api/org-reports/${id}/minutes`, {
            headers: await csrfHeaders(admin),
            data: {
              subject: 'Admin cannot issue',
              instruction: 'No.',
              toUserId: crypto.randomUUID(),
              idempotencyKey: `admin-${Date.now()}-minute01`,
            },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await Promise.all([md.dispose(), ops.dispose(), dma.dispose(), admin.dispose()]);
    }
  });

  test('CC is read-only; forward, minute, response, decision, email and isolation', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const ops = await playwright.request.newContext();
    const fh = await playwright.request.newContext();
    const dma = await playwright.request.newContext();
    const inv = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(fh, 'fh.yfz@nfc.local');
      await apiLogin(dma, 'gm.dma@nfc.local');
      await apiLogin(inv, 'inventory@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');

      const gmMe = await meOf(gm);
      const opsMe = await meOf(ops);
      const fhMe = await meOf(fh);
      const yfz = gmMe.entities.find((entity) => entity.code === 'YFZ')?.id;
      expect(yfz).toBeTruthy();

      const templates = (await (await gm.get(`${API}/api/org-reports/templates`)).json()) as Array<{
        key: string;
        title: string;
      }>;
      expect(templates.some((row) => /hod/i.test(row.key) || /hod/i.test(row.title))).toBe(false);
      expect(templates.find((row) => row.key === 'hr_staff')).toBeUndefined();

      const allTemplates = (await (await admin.get(`${API}/api/org-reports/templates?all=1`)).json()) as Array<{
        key: string;
        available: boolean;
      }>;
      expect(allTemplates.find((row) => row.key === 'payroll')?.available).toBe(true);

      expect(
        (
          await inv.post(`${API}/api/org-reports`, {
            headers: await csrfHeaders(inv),
            data: {
              entityId: yfz,
              templateKey: 'financial',
              title: unique('M16 inv financial'),
              body: 'Should be refused.',
              idempotencyKey: `inv-fin-${Date.now()}-xxxxxxxx`,
            },
          })
        ).status(),
      ).toBe(403);

      const created = await gm.post(`${API}/api/org-reports`, {
        headers: await csrfHeaders(gm),
        data: {
          entityId: yfz,
          templateKey: 'general',
          title: unique('M16 correspondence'),
          body: 'For the MD, copied to Operations.',
          ccUserIds: [opsMe.ref],
          idempotencyKey: `gm-create-${Date.now()}-xxxxxxxx`,
        },
      });
      expect(created.ok()).toBeTruthy();
      const draft = (await created.json()) as { id: string; rowVersion: number };
      const submittedRes = await gm.post(`${API}/api/org-reports/${draft.id}/submit`, {
        headers: await csrfHeaders(gm),
        data: { idempotencyKey: `gm-submit-${Date.now()}-xxxxxxxx`, rowVersion: draft.rowVersion },
      });
      expect(submittedRes.ok()).toBeTruthy();
      const submitted = (await submittedRes.json()) as {
        id: string;
        rowVersion: number;
        originalTo: { id: string } | null;
        originalCc: Array<{ id: string }>;
      };

      const asCc = await ops.get(`${API}/api/org-reports/${submitted.id}`);
      expect(asCc.ok()).toBeTruthy();
      expect(((await asCc.json()) as { myKind: string }).myKind).toBe('CC');
      expect(
        (
          await ops.post(`${API}/api/org-reports/${submitted.id}/forward`, {
            headers: await csrfHeaders(ops),
            data: { userIds: [fhMe.ref], rowVersion: submitted.rowVersion },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await ops.post(`${API}/api/org-reports/${submitted.id}/email`, {
            headers: await csrfHeaders(ops),
            data: {
              recipientEmail: 'outside@example.com',
              subject: 'No',
              message: 'CC cannot send.',
              idempotencyKey: `cc-email-${Date.now()}-xxxxxxxx`,
            },
          })
        ).status(),
      ).toBe(403);

      const mdView = (await (await md.get(`${API}/api/org-reports/${submitted.id}`)).json()) as {
        rowVersion: number;
        originalTo: { id: string } | null;
      };
      const forwarded = await md.post(`${API}/api/org-reports/${submitted.id}/forward`, {
        headers: await csrfHeaders(md),
        data: { userIds: [opsMe.ref], note: 'Also for information.', rowVersion: mdView.rowVersion },
      });
      expect(forwarded.ok()).toBeTruthy();
      const forwardedBody = (await forwarded.json()) as {
        originalTo: { id: string } | null;
        originalCc: Array<{ id: string }>;
        forwards: unknown[];
      };
      expect(forwardedBody.originalTo?.id).toBe(mdView.originalTo?.id);
      expect(forwardedBody.originalCc.map((row) => row.id)).toEqual(submitted.originalCc.map((row) => row.id));
      expect(forwardedBody.forwards.length).toBeGreaterThan(0);

      const assignedOps = (await (await ops.get(`${API}/api/org-reports/minutes/assigned`)).json()) as Array<{
        sourceReportId: string;
      }>;
      expect(assignedOps.some((row) => row.sourceReportId === submitted.id)).toBe(false);

      const minuteRes = await md.post(`${API}/api/org-reports/${submitted.id}/minutes`, {
        headers: await csrfHeaders(md),
        data: {
          subject: unique('M16 minute'),
          instruction: 'Finance Head to confirm the position.',
          toUserId: fhMe.ref,
          ccUserIds: [gmMe.ref],
          idempotencyKey: `md-minute-${Date.now()}-xxxxxxxx`,
        },
      });
      expect(minuteRes.ok()).toBeTruthy();
      const minute = (await minuteRes.json()) as { id: string; rowVersion: number; referenceNumber: string };
      expect(minute.referenceNumber.startsWith('MIN-')).toBe(true);
      expect(
        (
          await md.post(`${API}/api/org-reports/minutes/${minute.id}/issue`, {
            headers: await csrfHeaders(md),
            data: { rowVersion: minute.rowVersion },
          })
        ).ok(),
      ).toBeTruthy();

      const assignedFh = (await (await fh.get(`${API}/api/org-reports/minutes/assigned`)).json()) as Array<{
        id: string;
      }>;
      expect(assignedFh.some((row) => row.id === minute.id)).toBe(true);

      const responseRes = await fh.post(`${API}/api/org-reports/minutes/${minute.id}/responses`, {
        headers: await csrfHeaders(fh),
        data: {
          subject: 'Position submitted',
          body: 'Cash position attached as evidence.',
          idempotencyKey: `fh-rsp-${Date.now()}-xxxxxxxx`,
        },
      });
      expect(responseRes.ok()).toBeTruthy();
      const withResponse = (await responseRes.json()) as {
        rowVersion: number;
        responses: Array<{ referenceNumber: string }>;
      };
      expect(withResponse.responses[0]?.referenceNumber.startsWith('RSP-')).toBe(true);

      const reviewed = await md.post(`${API}/api/org-reports/minutes/${minute.id}/review`, {
        headers: await csrfHeaders(md),
        data: { action: 'further', note: 'Add the annex.', rowVersion: withResponse.rowVersion },
      });
      expect(reviewed.ok()).toBeTruthy();
      const further = (await reviewed.json()) as { rowVersion: number; responses: unknown[] };
      expect(further.responses).toHaveLength(1);

      const second = await fh.post(`${API}/api/org-reports/minutes/${minute.id}/responses`, {
        headers: await csrfHeaders(fh),
        data: {
          subject: 'Annex supplied',
          body: 'Further action completed.',
          idempotencyKey: `fh-rsp2-${Date.now()}-xxxxxxxx`,
        },
      });
      const secondBody = (await second.json()) as { rowVersion: number; responses: unknown[] };
      expect(secondBody.responses).toHaveLength(2);

      expect(
        (
          await md.post(`${API}/api/org-reports/minutes/${minute.id}/review`, {
            headers: await csrfHeaders(md),
            data: { action: 'accept', rowVersion: secondBody.rowVersion },
          })
        ).ok(),
      ).toBeTruthy();

      const decision = await md.post(`${API}/api/org-reports/${submitted.id}/decisions`, {
        headers: await csrfHeaders(md),
        data: {
          subject: unique('M16 decision'),
          body: 'Approved as a separate management record.',
          minuteId: minute.id,
        },
      });
      expect(decision.ok()).toBeTruthy();
      expect(((await decision.json()) as { referenceNumber: string }).referenceNumber.startsWith('DEC-')).toBe(true);

      const history = (await (await md.get(`${API}/api/org-reports/${submitted.id}`)).json()) as {
        history: Array<{ action: string }>;
        currentRevisionId: string;
        rowVersion: number;
      };
      const actions = history.history.map((row) => row.action).join(' ');
      expect(actions).toMatch(/Submitted/i);
      expect(actions).toMatch(/Forwarded/i);
      expect(actions).toMatch(/minute/i);
      expect(actions).toMatch(/Response/i);
      expect(actions).toMatch(/decision/i);

      expect(
        (
          await gm.patch(`${API}/api/org-reports/${submitted.id}`, {
            headers: await csrfHeaders(gm),
            data: { title: 'Silent change', rowVersion: history.rowVersion },
          })
        ).status(),
      ).toBe(403);

      const amend = await gm.post(`${API}/api/org-reports/${submitted.id}/amend`, {
        headers: await csrfHeaders(gm),
        data: {
          body: 'Controlled amendment after issue.',
          reason: 'Correct a figure.',
          rowVersion: history.rowVersion,
        },
      });
      expect(amend.ok()).toBeTruthy();
      expect(((await amend.json()) as { currentRevisionId: string }).currentRevisionId).not.toBe(
        history.currentRevisionId,
      );

      const retryKey = `retry-${Date.now()}-xxxxxxxx`;
      const firstCreate = await gm.post(`${API}/api/org-reports`, {
        headers: await csrfHeaders(gm),
        data: {
          entityId: yfz,
          templateKey: 'general',
          title: unique('M16 retry'),
          body: 'Idempotent create.',
          idempotencyKey: retryKey,
        },
      });
      const secondCreate = await gm.post(`${API}/api/org-reports`, {
        headers: await csrfHeaders(gm),
        data: {
          entityId: yfz,
          templateKey: 'general',
          title: unique('M16 retry again'),
          body: 'Should not duplicate.',
          idempotencyKey: retryKey,
        },
      });
      expect(((await firstCreate.json()) as { id: string }).id).toBe(((await secondCreate.json()) as { id: string }).id);

      expect((await dma.get(`${API}/api/org-reports/${submitted.id}`)).status()).toBe(404);

      expect(
        (
          await md.post(`${API}/api/org-reports/${submitted.id}/revoke-access`, {
            headers: await csrfHeaders(md),
            data: { userId: opsMe.ref },
          })
        ).ok(),
      ).toBeTruthy();
      expect((await ops.get(`${API}/api/org-reports/${submitted.id}`)).status()).toBe(404);
    } finally {
      await Promise.all([
        gm.dispose(),
        md.dispose(),
        ops.dispose(),
        fh.dispose(),
        dma.dispose(),
        inv.dispose(),
        admin.dispose(),
      ]);
    }
  });

  test('Administrator reaches templates only and Reports hub stays operational', async ({ page }) => {
    await loginAs(page, 'administrator@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Official reports', { exact: true })).toBeVisible();
    await nav.getByText('Official reports', { exact: true }).click();
    await expect(page).toHaveURL(/\/org-reports\/admin\/templates/);
    await expect(page.getByRole('heading', { name: 'Report templates' })).toBeVisible();
    await expect(page.getByText('Issue official minute')).toHaveCount(0);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });
});
