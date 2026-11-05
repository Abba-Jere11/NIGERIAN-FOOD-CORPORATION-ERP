import { expect, test } from '@playwright/test';
import { apiLogin, csrfHeaders, loginAs } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M3 engines', () => {
  test('the header search and notification bell are usable', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await expect(page.getByLabel('Global search')).toBeEnabled();
    await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();
  });

  test('100 parallel allocates produce 100 unique sequential PR numbers', async ({ playwright }) => {
    test.setTimeout(120_000);
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'md@nfc.local');
      const headers = await csrfHeaders(api);
      const responses = await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          api.post(`${API}/api/engine/records`, {
            headers,
            data: { title: `Parallel ${index}`, kind: 'PR' },
          }),
        ),
      );
      const bodies = await Promise.all(
        responses.map(async (response) => {
          expect(response.ok(), await response.text()).toBeTruthy();
          return (await response.json()) as { referenceNumber: string };
        }),
      );
      const refs = bodies.map((body) => body.referenceNumber);
      expect(new Set(refs).size).toBe(100);
      const sequences = refs.map((value) => Number.parseInt(value.slice(-6), 10)).sort((a, b) => a - b);
      for (let i = 1; i < sequences.length; i += 1) {
        expect(sequences[i]).toBe((sequences[i - 1] ?? 0) + 1);
      }
    } finally {
      await api.dispose();
    }
  });

  test('YFZ GM does not see DMA search hits for the same vendor name', async ({ playwright }) => {
    const yfz = await playwright.request.newContext();
    const dma = await playwright.request.newContext();
    try {
      await apiLogin(yfz, 'gm.yfz@nfc.local');
      await apiLogin(dma, 'gm.dma@nfc.local');
      const yfzHits = (await (await yfz.get(`${API}/api/search`, { params: { q: 'XYZ Limited' } })).json()) as {
        groups: Array<{ hits: Array<{ entityId: string; title: string }> }>;
      };
      const dmaHits = (await (await dma.get(`${API}/api/search`, { params: { q: 'XYZ Limited' } })).json()) as {
        groups: Array<{ hits: Array<{ entityId: string; title: string }> }>;
      };
      const yfzTitles = yfzHits.groups.flatMap((group) => group.hits.map((hit) => hit.title)).join(' ');
      const dmaTitles = dmaHits.groups.flatMap((group) => group.hits.map((hit) => hit.title)).join(' ');
      expect(yfzTitles).toMatch(/Yobe Fertilizer/);
      expect(yfzTitles).not.toMatch(/Damaturu/);
      expect(dmaTitles).toMatch(/Damaturu/);
      expect(dmaTitles).not.toMatch(/Yobe Fertilizer/);
    } finally {
      await yfz.dispose();
      await dma.dispose();
    }
  });

  test('creating a numbered record delivers an in-app notice that can be marked read', async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'gm.yfz@nfc.local');
      const created = await api.post(`${API}/api/engine/records`, {
        headers: await csrfHeaders(api),
        data: { title: 'Notice fixture', kind: 'DOC' },
      });
      expect(created.ok()).toBeTruthy();
      const record = (await created.json()) as { referenceNumber: string };
      const list = (await (await api.get(`${API}/api/notifications`)).json()) as Array<{
        id: string;
        body: string;
        readAt: string | null;
      }>;
      const notice = list.find((row) => row.body.includes(record.referenceNumber));
      expect(notice).toBeTruthy();
      expect(notice?.readAt).toBeNull();
      const marked = await api.post(`${API}/api/notifications/${notice?.id}/read`, {
        headers: await csrfHeaders(api),
      });
      expect(marked.ok()).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('the GM is refused Overdue Workflows', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'gm.yfz@nfc.local');
      expect((await api.get(`${API}/api/workflows/overdue`)).status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });

  test('the MD can list overdue workflows', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'md@nfc.local');
      const response = await api.get(`${API}/api/workflows/overdue`);
      expect(response.ok(), await response.text()).toBeTruthy();
      expect(Array.isArray(await response.json())).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('mandatory email preferences cannot be turned off', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'gm.yfz@nfc.local');
      const refused = await api.patch(`${API}/api/notifications/preferences`, {
        headers: await csrfHeaders(api),
        data: { category: 'action_required', emailEnabled: false },
      });
      expect(refused.status()).toBe(400);
      const allowed = await api.patch(`${API}/api/notifications/preferences`, {
        headers: await csrfHeaders(api),
        data: { category: 'engine', emailEnabled: false },
      });
      expect(allowed.ok(), await allowed.text()).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('the timeline page renders events in order', async ({ page }) => {
    await loginAs(page, 'md@nfc.local');
    await page.goto('/timeline');
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    const items = page.locator('ol li');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('Record opened as a draft.');
    await expect(items.nth(1)).toContainText('Submitted for review.');
  });
});
