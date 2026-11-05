import { expect, test } from '@playwright/test';
import { ROLE_KEYS } from '@nfc/shared';
import { apiLogin, csrfHeaders, goto, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M17 HR people system', () => {
  test('HR Officer sees the HR module; Administrator and GM do not', async ({ page }) => {
    expect([...ROLE_KEYS]).toContain('hr_officer');
    expect([...ROLE_KEYS]).not.toContain('payroll_officer');
    expect(ROLE_KEYS).toHaveLength(9);

    await goto(page, '/home/hr', 'hr@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('HR', { exact: true })).toBeVisible();
    await expect(page.getByText('Headcount', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Employees' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Recruitment' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Disciplinary' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Training' })).toBeVisible();

    await goto(page, '/home/admin', 'administrator@nfc.local');
    await expect(
      page.getByRole('navigation', { name: 'Modules' }).getByText('HR', { exact: true }),
    ).toHaveCount(0);

    await goto(page, '/home/gm', 'gm.yfz@nfc.local');
    await expect(
      page.getByRole('navigation', { name: 'Modules' }).getByText('HR', { exact: true }),
    ).toHaveCount(0);
  });

  test('HR Officer creates an employee record with EMP- and an EDMS folder', async ({ page }) => {
    await goto(page, '/hr/employees/new', 'hr@nfc.local');
    await expect(page.getByRole('heading', { name: 'New employee' })).toBeVisible();
    const last = unique('Bukar');
    await page.getByLabel('Subsidiary').selectOption({ index: 1 });
    await page.getByLabel('First name').fill('Aisha');
    await page.getByLabel('Last name').fill(last);
    await page.getByLabel('Work email').fill(`aisha.${Date.now()}@nfc.local`);
    await page.getByLabel('Bank name').fill('Zenith Bank');
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page.getByRole('heading', { name: `Aisha ${last}` })).toBeVisible();
    await expect(page.getByText(/EMP-\d{4}-\d{6}/)).toBeVisible();
    await expect(page.getByText('HR user folder created')).toBeVisible();
    await expect(page.getByText('Zenith Bank')).toBeVisible();
  });

  test('GM and Administrator cannot open an employee; HR Officer can across subsidiaries', async ({
    playwright,
  }) => {
    const hr = await playwright.request.newContext();
    const gm = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(hr, 'hr@nfc.local');
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');
      const me = (await (await hr.get(`${API}/api/me`)).json()) as {
        entities: Array<{ id: string; code: string }>;
      };
      const yfz = me.entities.find((row) => row.code === 'YFZ');
      const dma = me.entities.find((row) => row.code === 'DMA');
      expect(yfz && dma).toBeTruthy();
      const departments = (await (
        await hr.get(`${API}/api/entities/${yfz!.id}/departments`)
      ).json()) as Array<{ id: string; name: string }>;
      const hrDept = departments.find((row) => row.name === 'HR');
      expect(hrDept).toBeTruthy();
      const created = await hr.post(`${API}/api/hr/employees`, {
        headers: await csrfHeaders(hr),
        data: {
          entityId: yfz!.id,
          departmentId: hrDept!.id,
          firstName: 'Cross',
          lastName: unique('Check'),
          idempotencyKey: `e2e-${crypto.randomUUID()}`,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const body = (await created.json()) as { id: string; referenceNumber: string };
      expect(body.referenceNumber.startsWith('EMP-')).toBe(true);

      expect((await gm.get(`${API}/api/hr/employees/${body.id}`)).status()).toBe(403);
      expect((await admin.get(`${API}/api/hr/employees/${body.id}`)).status()).toBe(403);
      expect((await gm.get(`${API}/api/hr/employees`)).status()).toBe(403);
      expect((await admin.get(`${API}/api/hr/disciplinary`)).ok()).toBeTruthy();
      expect(await (await admin.get(`${API}/api/hr/disciplinary`)).json()).toEqual([]);

      const dmaDepts = (await (
        await hr.get(`${API}/api/entities/${dma!.id}/departments`)
      ).json()) as Array<{ id: string; name: string }>;
      const dmaHr = dmaDepts.find((row) => row.name === 'HR');
      const dmaEmp = await hr.post(`${API}/api/hr/employees`, {
        headers: await csrfHeaders(hr),
        data: {
          entityId: dma!.id,
          departmentId: dmaHr!.id,
          firstName: 'Damaturu',
          lastName: unique('Staff'),
          idempotencyKey: `e2e-${crypto.randomUUID()}`,
        },
      });
      expect(dmaEmp.ok(), await dmaEmp.text()).toBeTruthy();
      const listed = (await (await hr.get(`${API}/api/hr/employees`)).json()) as Array<{
        entityCode: string;
      }>;
      expect(listed.some((row) => row.entityCode === 'YFZ')).toBe(true);
      expect(listed.some((row) => row.entityCode === 'DMA')).toBe(true);
    } finally {
      await Promise.all([hr.dispose(), gm.dispose(), admin.dispose()]);
    }
  });

  test('MD home shows the disciplinary queue and not the employee directory', async ({ page }) => {
    await goto(page, '/home/md', 'md@nfc.local');
    await expect(page.getByText('Disciplinary awaiting decision')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Modules' }).getByText('HR', { exact: true }),
    ).toHaveCount(0);
    await page.goto('/hr/employees');
    await expect(page).toHaveURL(/\/forbidden|\/home\/md/);
  });
});
