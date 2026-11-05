import { Secret, TOTP } from 'otpauth';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { TOTP_FIXTURE_SECRET } from '@nfc/shared';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? '';

export function totpNow(secret = TOTP_FIXTURE_SECRET): string {
  const totp = new TOTP({
    issuer: 'NFC',
    label: 'NFC',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.generate();
}

export async function loginAs(page: Page, email: string): Promise<void> {
  if (!PASSWORD) {
    throw new Error('SEED_USER_PASSWORD must be set for end-to-end tests.');
  }
  // Sign in through the API so session cookies land on the shared 127.0.0.1 host
  // (Playwright cookies are per-domain, not per-port). The login form is covered
  // by identity.spec.ts; this helper only needs an authenticated browser.
  await apiLogin(page.request, email);
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForURL((url) => url.pathname === '/home' || url.pathname.startsWith('/home/'), {
    timeout: 45_000,
  });
}

export async function apiLogin(request: APIRequestContext, email: string): Promise<void> {
  if (!PASSWORD) {
    throw new Error('SEED_USER_PASSWORD must be set for end-to-end tests.');
  }
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';
  const login = await request.post(`${api}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(login.ok(), `login failed for ${email}`).toBeTruthy();
  const body = (await login.json()) as { mfaRequired?: boolean };
  if (body.mfaRequired) {
    const mfa = await request.post(`${api}/api/auth/mfa`, { data: { code: totpNow() } });
    expect(mfa.ok(), `mfa failed for ${email}`).toBeTruthy();
  }
}

export async function goto(page: Page, path: string, email?: string): Promise<void> {
  if (email) await loginAs(page, email);
  await page.goto(path, { waitUntil: 'commit' });
}

export async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const state = await request.storageState();
  const token = state.cookies.find((cookie) => cookie.name === 'nfc_csrf')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36).toUpperCase()}`;
}
