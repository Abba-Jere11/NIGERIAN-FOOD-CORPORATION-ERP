import { expect, test } from '@playwright/test';
import {
  ADMINISTRATOR_USER_ID,
  LOGIN_LOCKOUT_THRESHOLD,
  seedUserByEmail,
} from '@nfc/shared';
import { apiLogin, csrfHeaders, loginAs, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

const HOMES = [
  { email: 'gm.yfz@nfc.local', path: '/home/gm', nav: 'Home', kpi: 'My requests this month' },
  { email: 'ed.operations@nfc.local', path: '/home/ed-operations', nav: 'Home', kpi: 'Awaiting my review' },
  { email: 'md@nfc.local', path: '/home/md', nav: 'Audit log', kpi: 'Pending my final approval' },
  { email: 'ed.finance@nfc.local', path: '/home/ed-finance', nav: 'Audit log', kpi: 'Cash position' },
  { email: 'fh.yfz@nfc.local', path: '/home/finance-head', nav: 'Home', kpi: 'Awaiting payment' },
  { email: 'inventory@nfc.local', path: '/home/inventory', nav: 'Home', kpi: 'Partially received' },
  { email: 'administrator@nfc.local', path: '/home/admin', nav: 'Users', kpi: null },
  { email: 'hr@nfc.local', path: '/home/hr', nav: 'HR', kpi: 'Headcount' },
] as const;

test.describe('identity and access', () => {
  test('uses a single login URL for every role', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('One sign-in for every role.')).toBeVisible();
  });

  for (const home of HOMES) {
    test(`${home.email} reaches ${home.path}`, async ({ page }) => {
      await loginAs(page, home.email);
      await expect(page).toHaveURL(new RegExp(`${home.path}$`));
      await expect(page.getByRole('navigation', { name: 'Modules' }).getByText(home.nav)).toBeVisible();
      if (home.kpi) {
        await expect(page.getByText(home.kpi, { exact: true })).toBeVisible();
      }
    });
  }

  test('requires an authenticator code after the password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('md@nfc.local');
    await page.getByLabel('Password').fill(process.env.SEED_USER_PASSWORD ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Authenticator code' })).toBeVisible();
  });

  test('the Administrator is refused the audit log', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'administrator@nfc.local');
      expect((await api.get(`${API}/api/audit`)).status()).toBe(403);
      expect((await api.get(`${API}/api/audit/export`)).status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });

  test('the MD is refused entity create', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'md@nfc.local');
      const response = await api.post(`${API}/api/entities`, {
        headers: await csrfHeaders(api),
        data: { code: 'NOPE', name: 'Nope', legalName: 'Nope Limited', type: 'SUBSIDIARY' },
      });
      expect(response.status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });

  test('the Administrator cannot assign a payment key to themselves', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'administrator@nfc.local');
      const response = await api.post(`${API}/api/admin/users/${ADMINISTRATOR_USER_ID}/roles`, {
        headers: await csrfHeaders(api),
        data: { role: 'finance_head', scopeType: 'ENTITY', entityId: null },
      });
      expect([400, 403, 409]).toContain(response.status());
    } finally {
      await api.dispose();
    }
  });

  test.describe('account lockout', () => {
    test.describe.configure({ retries: 0 });
    test('locks the account after too many failed passwords', async ({
      page,
      playwright,
    }) => {
    const password = process.env.SEED_USER_PASSWORD ?? '';
    const lockedEmail = `lockout.${Date.now()}@nfc.local`;
    const admin = await playwright.request.newContext();
    const attempts = await playwright.request.newContext();
    let lockedUserId: string | undefined;
    try {
      await apiLogin(admin, 'administrator@nfc.local');
      const entities = (await (await admin.get(`${API}/api/entities`)).json()) as Array<{
        id: string;
        code: string;
      }>;
      const yfz = entities.find((entity) => entity.code === 'YFZ');
      expect(yfz).toBeDefined();
      const created = await admin.post(`${API}/api/admin/users`, {
        headers: await csrfHeaders(admin),
        data: {
          name: 'Lockout Probe',
          email: lockedEmail,
          position: 'Lockout probe',
          primaryEntityId: yfz?.id,
          password,
          role: 'gm',
          scopeType: 'ENTITY',
          entityId: yfz?.id,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const body = (await created.json()) as { id: string };
      lockedUserId = body.id;

      for (let i = 0; i < LOGIN_LOCKOUT_THRESHOLD; i += 1) {
        const failed = await attempts.post(`${API}/api/auth/login`, {
          data: { email: lockedEmail, password: `wrong-password-${i}` },
        });
        expect(failed.status()).toBe(401);
      }

      const locked = await attempts.post(`${API}/api/auth/login`, {
        data: { email: lockedEmail, password },
      });
      expect(locked.status()).toBe(401);
      const lockedBody = (await locked.json()) as { error?: { message?: string } };
      expect(lockedBody.error?.message ?? '').toMatch(/locked/i);

      await page.goto('/login');
      await page.getByLabel('Email').fill(lockedEmail);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('alert').filter({ hasText: /locked/i })).toBeVisible();
    } finally {
      if (lockedUserId) {
        await admin
          .post(`${API}/api/admin/users/${lockedUserId}/unlock`, {
            headers: await csrfHeaders(admin),
            data: { reason: 'Unlock after the lockout check.' },
          })
          .catch(() => undefined);
      }
      await admin.dispose();
      await attempts.dispose();
    }
  });
  });

  test('a revoked session is refused on the next request', async ({ page, playwright }) => {
    const email = 'gm.nom@nfc.local';
    const user = seedUserByEmail(email);
    expect(user).toBeDefined();

    await loginAs(page, email);
    await expect(page).toHaveURL(/\/home\/gm$/);

    const admin = await playwright.request.newContext();
    try {
      await apiLogin(admin, 'administrator@nfc.local');
      const revoked = await admin.post(`${API}/api/admin/users/${user?.id}/sessions/revoke`, {
        headers: await csrfHeaders(admin),
        data: { reason: 'End-to-end session revocation.' },
      });
      expect(revoked.ok(), await revoked.text()).toBeTruthy();
    } finally {
      await admin.dispose();
    }

    await page.goto('/home/gm');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a permission change appears in the Administrator log', async ({ page, playwright }) => {
    const subject = seedUserByEmail('gm.yfw@nfc.local');
    expect(subject).toBeDefined();
    const reason = unique('E2E extra entity grant');
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(admin, 'administrator@nfc.local');
      const entities = (await (await admin.get(`${API}/api/entities`)).json()) as Array<{
        id: string;
        code: string;
      }>;
      const dma = entities.find((entity) => entity.code === 'DMA');
      expect(dma).toBeDefined();

      const granted = await admin.post(`${API}/api/admin/users/${subject?.id}/grants`, {
        headers: await csrfHeaders(admin),
        data: { entityId: dma?.id, reason },
      });
      expect(granted.ok(), await granted.text()).toBeTruthy();

      const log = (await (await admin.get(`${API}/api/admin/permission-changes`)).json()) as Array<{
        action: string;
        subjectLabel: string | null;
        reason: string | null;
      }>;
      expect(
        log.some(
          (row) =>
            row.action === 'permission_change' &&
            row.subjectLabel === subject?.email &&
            row.reason === reason,
        ),
      ).toBe(true);
    } finally {
      await admin.dispose();
    }

    await loginAs(page, 'administrator@nfc.local');
    await page.goto('/admin/permission-log');
    await expect(page.getByRole('heading', { name: 'Permission log' })).toBeVisible();
    await expect(page.getByText('permission_change').first()).toBeVisible();
    await expect(page.getByText('gm.yfw@nfc.local').first()).toBeVisible();
  });

  test('first login can enrol MFA and change password in either order', async ({ playwright }) => {
    const password = process.env.SEED_USER_PASSWORD ?? '';
    const nextPassword = `Onboard-${Date.now()}Aa!`;
    const email = `onboard.${Date.now()}@nfc.local`;
    const admin = await playwright.request.newContext();
    const newbie = await playwright.request.newContext();
    try {
      await apiLogin(admin, 'administrator@nfc.local');
      const entities = (await (await admin.get(`${API}/api/entities`)).json()) as Array<{
        id: string;
        code: string;
      }>;
      const yfz = entities.find((entity) => entity.code === 'YFZ');
      expect(yfz).toBeDefined();
      const created = await admin.post(`${API}/api/admin/users`, {
        headers: await csrfHeaders(admin),
        data: {
          name: 'Onboarding Probe',
          email,
          position: 'Onboarding probe',
          primaryEntityId: yfz?.id,
          password,
          role: 'gm',
          scopeType: 'ENTITY',
          entityId: yfz?.id,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const createdBody = (await created.json()) as { id: string };
      const policy = await admin.post(`${API}/api/admin/users/${createdBody.id}/mfa-policy`, {
        headers: await csrfHeaders(admin),
        data: { required: true, reason: 'E2E MFA onboarding probe' },
      });
      expect(policy.ok(), await policy.text()).toBeTruthy();

      const login = await newbie.post(`${API}/api/auth/login`, {
        data: { email, password },
      });
      expect(login.ok(), await login.text()).toBeTruthy();
      const loginBody = (await login.json()) as {
        mfaRequired?: boolean;
        mustChangePassword?: boolean;
        mfaEnrolRequired?: boolean;
      };
      expect(loginBody.mfaRequired).toBe(false);
      expect(loginBody.mustChangePassword).toBe(true);
      expect(loginBody.mfaEnrolRequired).toBe(true);

      const headers = await csrfHeaders(newbie);
      const enrol = await newbie.post(`${API}/api/auth/mfa/enrol`, { headers });
      expect(enrol.status(), await enrol.text()).not.toBe(403);
      expect(enrol.ok(), await enrol.text()).toBeTruthy();

      const changed = await newbie.post(`${API}/api/auth/change-password`, {
        headers,
        data: { currentPassword: password, password: nextPassword },
      });
      expect(changed.status(), await changed.text()).not.toBe(403);
      expect(changed.ok(), await changed.text()).toBeTruthy();
    } finally {
      await admin.dispose();
      await newbie.dispose();
    }
  });

  test('new users sign in without MFA unless an Administrator requires it', async ({ playwright }) => {
    const password = process.env.SEED_USER_PASSWORD ?? '';
    const nextPassword = `NoMfa-${Date.now()}Aa!`;
    const email = `nomfa.${Date.now()}@nfc.local`;
    const admin = await playwright.request.newContext();
    const newbie = await playwright.request.newContext();
    try {
      await apiLogin(admin, 'administrator@nfc.local');
      const entities = (await (await admin.get(`${API}/api/entities`)).json()) as Array<{
        id: string;
        code: string;
      }>;
      const yfz = entities.find((entity) => entity.code === 'YFZ');
      expect(yfz).toBeDefined();
      const created = await admin.post(`${API}/api/admin/users`, {
        headers: await csrfHeaders(admin),
        data: {
          name: 'No MFA Probe',
          email,
          position: 'No MFA probe',
          primaryEntityId: yfz?.id,
          password,
          role: 'gm',
          scopeType: 'ENTITY',
          entityId: yfz?.id,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const createdBody = (await created.json()) as {
        mfaRequired: boolean;
        mfaEffectiveRequired: boolean;
      };
      expect(createdBody.mfaRequired).toBe(false);
      expect(createdBody.mfaEffectiveRequired).toBe(false);

      const login = await newbie.post(`${API}/api/auth/login`, { data: { email, password } });
      expect(login.ok(), await login.text()).toBeTruthy();
      const loginBody = (await login.json()) as { mfaRequired?: boolean; mfaEnrolRequired?: boolean };
      expect(loginBody.mfaRequired).toBe(false);
      expect(loginBody.mfaEnrolRequired).toBe(false);

      const headers = await csrfHeaders(newbie);
      const enrol = await newbie.post(`${API}/api/auth/mfa/enrol`, { headers });
      expect(enrol.ok()).toBeFalsy();

      const changed = await newbie.post(`${API}/api/auth/change-password`, {
        headers,
        data: { currentPassword: password, password: nextPassword },
      });
      expect(changed.ok(), await changed.text()).toBeTruthy();
      expect(((await changed.json()) as { mfaEnrolRequired: boolean }).mfaEnrolRequired).toBe(false);

      const me = await newbie.get(`${API}/api/me`);
      expect(me.ok(), await me.text()).toBeTruthy();
      expect(((await me.json()) as { mfaRequired: boolean }).mfaRequired).toBe(false);
      const entitiesForNewbie = await newbie.get(`${API}/api/entities`);
      expect(entitiesForNewbie.status(), await entitiesForNewbie.text()).not.toBe(403);
    } finally {
      await admin.dispose();
      await newbie.dispose();
    }
  });
});
