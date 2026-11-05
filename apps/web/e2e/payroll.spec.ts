import { expect, test } from '@playwright/test';
import { ROLE_KEYS } from '@nfc/shared';
import { apiLogin, csrfHeaders, goto, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M18 payroll and HR reports', () => {
  test('HR Officer sees Payroll and Reports; Administrator and GM do not', async ({ page }) => {
    expect([...ROLE_KEYS]).not.toContain('payroll_officer');
    expect(ROLE_KEYS).toHaveLength(9);

    await goto(page, '/home/hr', 'hr@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByRole('link', { name: 'Payroll' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(page.getByText('Payroll runs', { exact: true })).toBeVisible();

    await goto(page, '/hr/payroll', 'hr@nfc.local');
    await expect(page.getByRole('heading', { name: 'Payroll runs' })).toBeVisible();

    await goto(page, '/hr/reports', 'hr@nfc.local');
    await expect(page.getByRole('heading', { name: 'Operational reports' })).toBeVisible();

    await goto(page, '/home/admin', 'administrator@nfc.local');
    await expect(
      page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: 'Payroll' }),
    ).toHaveCount(0);

    await goto(page, '/home/gm', 'gm.yfz@nfc.local');
    await expect(
      page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: 'Payroll' }),
    ).toHaveCount(0);
  });

  test('ED Finance home shows the Payroll tile', async ({ page }) => {
    await goto(page, '/home/ed-finance', 'ed.finance@nfc.local');
    await expect(page.getByText('Payroll', { exact: true })).toBeVisible();
  });

  test('GM, Administrator and Inventory cannot read runs or payslips', async ({ playwright }) => {
    const hr = await playwright.request.newContext();
    const gm = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    const inv = await playwright.request.newContext();
    try {
      await apiLogin(hr, 'hr@nfc.local');
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');
      await apiLogin(inv, 'inventory@nfc.local');

      const me = (await (await hr.get(`${API}/api/me`)).json()) as {
        entities: Array<{ id: string; code: string }>;
      };
      const yfz = me.entities.find((row) => row.code === 'YFZ');
      expect(yfz).toBeTruthy();
      const departments = (await (await hr.get(`${API}/api/entities/${yfz!.id}/departments`)).json()) as Array<{
        id: string;
        name: string;
      }>;
      const hrDept = departments.find((row) => row.name === 'HR');
      expect(hrDept).toBeTruthy();
      const createdEmp = await hr.post(`${API}/api/hr/employees`, {
        headers: await csrfHeaders(hr),
        data: {
          entityId: yfz!.id,
          departmentId: hrDept!.id,
          firstName: 'Pay',
          lastName: unique('E2E'),
          idempotencyKey: `e2e-${crypto.randomUUID()}`,
        },
      });
      expect(createdEmp.ok(), await createdEmp.text()).toBeTruthy();
      const employee = (await createdEmp.json()) as { id: string };
      const structure = await hr.post(`${API}/api/payroll/structures`, {
        headers: await csrfHeaders(hr),
        data: {
          entityId: yfz!.id,
          employeeId: employee.id,
          basicKobo: 500_000_00,
          effectiveOn: '2026-01-01',
        },
      });
      expect(structure.ok(), await structure.text()).toBeTruthy();
      const draft = (await structure.json()) as { id: string; rowVersion: number };
      const confirmed = await hr.post(`${API}/api/payroll/structures/${draft.id}/confirm`, {
        headers: await csrfHeaders(hr),
        data: { rowVersion: draft.rowVersion },
      });
      expect(confirmed.ok(), await confirmed.text()).toBeTruthy();

      const periods = (await (await hr.get(`${API}/api/payroll/periods?entityId=${yfz!.id}`)).json()) as Array<{
        id: string;
      }>;
      expect(periods[0]?.id).toBeTruthy();
      const runRes = await hr.post(`${API}/api/payroll/runs`, {
        headers: await csrfHeaders(hr),
        data: {
          entityId: yfz!.id,
          fiscalPeriodId: periods[0]!.id,
          idempotencyKey: `e2e-${crypto.randomUUID()}`,
        },
      });
      const runOk = runRes.ok();
      const runBody = (await runRes.json()) as { id?: string };
      const runId = runOk ? runBody.id : (await (await hr.get(`${API}/api/payroll/runs`)).json() as Array<{ id: string }>)[0]?.id;
      expect(runId).toBeTruthy();

      expect((await gm.get(`${API}/api/payroll/runs/${runId}`)).status()).toBe(403);
      expect((await admin.get(`${API}/api/payroll/runs/${runId}`)).status()).toBe(403);
      expect((await inv.get(`${API}/api/payroll/runs/${runId}`)).status()).toBe(403);
      expect((await gm.get(`${API}/api/payroll/runs/${runId}/payslips/${employee.id}`)).status()).toBe(403);
      expect((await admin.get(`${API}/api/org-reports/templates`)).ok()).toBeTruthy();
    } finally {
      await Promise.all([hr.dispose(), gm.dispose(), admin.dispose(), inv.dispose()]);
    }
  });
});
