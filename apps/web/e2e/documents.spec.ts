import { expect, test } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('M4 documents', () => {
  test('GM can upload; Administrator cannot; history is restricted after replace', async ({
    playwright,
  }) => {
    const gm = await playwright.request.newContext();
    const admin = await playwright.request.newContext();
    const md = await playwright.request.newContext();
    const dma = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      await apiLogin(admin, 'administrator@nfc.local');
      await apiLogin(md, 'md@nfc.local');
      await apiLogin(dma, 'gm.dma@nfc.local');

      const refused = await admin.post(`${API}/api/documents`, {
        headers: await csrfHeaders(admin),
        multipart: {
          title: 'Admin should fail',
          category: 'general',
          context: 'general',
          file: { name: 'a.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(refused.status()).toBe(403);

      const uploaded = await gm.post(`${API}/api/documents`, {
        headers: await csrfHeaders(gm),
        multipart: {
          title: `Invoice ${Date.now()}`,
          category: 'general',
          context: 'general',
          file: { name: 'Invoice.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
      const document = (await uploaded.json()) as { id: string; currentVersion: { id: string } };
      const firstVersion = document.currentVersion.id;

      const replaced = await gm.post(`${API}/api/documents/${document.id}/versions`, {
        headers: await csrfHeaders(gm),
        multipart: {
          reason: 'Corrected scan of the vendor invoice.',
          context: 'general',
          file: { name: 'Invoice-v2.png', mimeType: 'image/png', buffer: PNG },
        },
      });
      expect(replaced.ok(), await replaced.text()).toBeTruthy();

      const gmView = (await (await gm.get(`${API}/api/documents/${document.id}`)).json()) as {
        versions: Array<{ versionNumber: number }>;
      };
      expect(gmView.versions.map((row) => row.versionNumber)).toEqual([2]);

      const mdView = (await (await md.get(`${API}/api/documents/${document.id}`)).json()) as {
        versions: Array<{ versionNumber: number }>;
      };
      expect(mdView.versions.map((row) => row.versionNumber)).toEqual([1, 2]);

      const historyDenied = await gm.post(`${API}/api/documents/${document.id}/download-url`, {
        headers: await csrfHeaders(gm),
        data: { versionId: firstVersion },
      });
      expect(historyDenied.status()).toBe(403);

      const minted = (await (
        await md.post(`${API}/api/documents/${document.id}/download-url`, {
          headers: await csrfHeaders(md),
          data: { versionId: firstVersion },
        })
      ).json()) as { url: string };
      expect(minted.url).toContain('token=');

      const otherUser = await dma.get(`${API}${minted.url}`);
      expect(otherUser.status()).toBe(403);

      const historyOk = await md.get(`${API}${minted.url}`);
      expect(historyOk.ok(), await historyOk.text()).toBeTruthy();
    } finally {
      await Promise.all([gm.dispose(), admin.dispose(), md.dispose(), dma.dispose()]);
    }
  });
});
