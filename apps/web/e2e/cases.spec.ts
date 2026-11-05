import { expect, test } from '@playwright/test';
import { apiLogin, csrfHeaders, loginAs, unique } from './support';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

test.describe('M8 confidential cases', () => {
  test('MD opens Cases, creates one, and GM cannot see it', async ({ page, playwright }) => {
    await loginAs(page, 'md@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Cases', { exact: true })).toBeVisible();
    await nav.getByText('Cases', { exact: true }).click();
    await expect(page).toHaveURL(/\/cases$/);
    await page.getByRole('link', { name: 'New case' }).click();
    const title = unique('M8 case');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Details').fill('Restricted to people on the case.');
    await page.getByLabel('Subsidiary').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Open case' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(/CASE-\d{4}-\d{6}/)).toBeVisible();

    const gm = await playwright.request.newContext();
    try {
      await apiLogin(gm, 'gm.yfz@nfc.local');
      const list = await gm.get(`${API}/api/cases`);
      expect(list.ok()).toBeTruthy();
      const rows = (await list.json()) as Array<{ title: string }>;
      expect(rows.some((row) => row.title === title)).toBe(false);
    } finally {
      await gm.dispose();
    }
  });

  test('Administrator is refused case create and has no Cases nav', async ({ page, playwright }) => {
    await loginAs(page, 'administrator@nfc.local');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByText('Cases', { exact: true })).toHaveCount(0);
    await page.goto('/cases');
    await expect(page).toHaveURL(/\/forbidden$/);

    const api = await playwright.request.newContext();
    try {
      await apiLogin(api, 'administrator@nfc.local');
      const me = (await (await api.get(`${API}/api/me`)).json()) as {
        entities: Array<{ id: string }>;
      };
      const response = await api.post(`${API}/api/cases`, {
        headers: await csrfHeaders(api),
        data: {
          entityId: me.entities[0]?.id,
          title: 'Admin should not open this',
          body: 'Administrators have no case ACL bypass.',
        },
      });
      expect(response.status()).toBe(403);
    } finally {
      await api.dispose();
    }
  });
});
