import { expect, test } from '@playwright/test';
import { XYZ_VENDOR_ID, SAHEL_VENDOR_ID } from '@nfc/shared';
import { apiLogin, csrfHeaders, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('M5 vendors', () => {
  test('onboarding happy path, GM cannot see bank fields, suspended vendor is blocked', async ({
    playwright,
  }) => {
    const ops = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const gm = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    try {
      await apiLogin(ops, 'ed.operations@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');

      const refused = await admin.post(`${API}/api/vendors`, {
        headers: await csrfHeaders(admin),
        data: {
          legalName: 'Admin should fail',
          cacRegistrationNumber: `RC-${unique('A')}`,
          categoryId: '00000000-0000-4000-8000-000000000000',
        },
      });
      expect(refused.status()).toBe(403);

      const categories = (await (await ops.get(`${API}/api/vendors/categories`)).json()) as Array<{
        id: string;
        key: string;
      }>;
      const goods = categories.find((row) => row.key === 'goods');
      expect(goods).toBeTruthy();

      const suffix = unique('V');
      const created = await ops.post(`${API}/api/vendors`, {
        headers: await csrfHeaders(ops),
        data: {
          legalName: `E2E Vendor ${suffix}`,
          cacRegistrationNumber: `RC-${suffix.replace(/\s/g, '').slice(0, 12)}`,
          categoryId: goods!.id,
          bankName: 'GTBank',
          accountName: `E2E Vendor ${suffix}`,
          accountNumber: `55${Date.now().toString().slice(-8)}`,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const vendor = (await created.json()) as { id: string; referenceNumber: string; rowVersion: number };

      for (const type of ['CAC', 'TAX_CLEARANCE', 'BANK_VERIFICATION']) {
        const uploaded = await ops.post(`${API}/api/vendors/${vendor.id}/compliance-documents`, {
          headers: await csrfHeaders(ops),
          multipart: {
            complianceType: type,
            file: { name: `${type}.png`, mimeType: 'image/png', buffer: PNG },
          },
        });
        expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
      }

      const submitted = await ops.post(`${API}/api/vendors/${vendor.id}/submit`, {
        headers: await csrfHeaders(ops),
        data: {},
      });
      expect(submitted.ok(), await submitted.text()).toBeTruthy();

      const pending = (await (await md.get(`${API}/api/workflows/pending`)).json()) as Array<{
        id: string;
        referenceNumber: string;
      }>;
      const item = pending.find((row) => row.referenceNumber === vendor.referenceNumber);
      expect(item).toBeTruthy();
      const instance = (await (await md.get(`${API}/api/workflows/${item!.id}`)).json()) as {
        id: string;
        rowVersion: number;
      };
      const selfApprove = await ops.post(`${API}/api/workflows/${instance.id}/actions`, {
        headers: await csrfHeaders(ops),
        data: { action: 'APPROVE', rowVersion: instance.rowVersion },
      });
      expect(selfApprove.status()).toBe(403);

      const fresh = (await (await md.get(`${API}/api/workflows/${item!.id}`)).json()) as {
        rowVersion: number;
      };
      const approved = await md.post(`${API}/api/workflows/${item!.id}/actions`, {
        headers: await csrfHeaders(md),
        data: { action: 'APPROVE', rowVersion: fresh.rowVersion },
      });
      expect(approved.ok(), await approved.text()).toBeTruthy();

      const gmView = (await (await gm.get(`${API}/api/vendors/${vendor.id}`)).json()) as {
        bank: { accountNumber: string } | null;
        status: string;
      };
      expect(gmView.status).toBe('ACTIVE');
      expect(gmView.bank).toBeNull();
      const body = await (await gm.get(`${API}/api/vendors/${vendor.id}`)).text();
      expect(body).not.toContain('accountNumber');

      const xyz = (await (await gm.get(`${API}/api/vendors/${XYZ_VENDOR_ID}`)).json()) as {
        bank: unknown;
      };
      expect(xyz.bank).toBeNull();

      const blocked = await gm.get(`${API}/api/vendors/validate/${SAHEL_VENDOR_ID}`);
      expect(blocked.status()).toBe(400);

      const selectable = await gm.get(`${API}/api/vendors/validate/${vendor.id}`);
      expect(selectable.ok()).toBeTruthy();
    } finally {
      await Promise.all([ops.dispose(), md.dispose(), gm.dispose(), admin.dispose()]);
    }
  });
});
