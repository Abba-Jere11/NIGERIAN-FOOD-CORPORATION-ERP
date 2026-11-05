'use server';

import { redirect } from 'next/navigation';
import type { CsrfView, LoginResultView } from '@nfc/shared';
import { apiFetch, ApiError } from './api';

export async function ensureCsrf(): Promise<string> {
  const result = await apiFetch<CsrfView>('/api/auth/csrf');
  return result.csrfToken;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResultView | { error: string }> {
  try {
    await ensureCsrf();
    return await apiFetch<LoginResultView>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Sign-in failed.' };
  }
}

export async function verifyMfaCode(code: string): Promise<LoginResultView | { error: string }> {
  try {
    return await apiFetch<LoginResultView>('/api/auth/mfa', { method: 'POST', body: { code } });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Verification failed.' };
  }
}

export async function changePasswordAction(
  currentPassword: string,
  password: string,
): Promise<
  { ok: true; mfaEnrolRequired: boolean } | { error: string; fieldErrors?: Record<string, string[]> }
> {
  try {
    const body = await apiFetch<{ ok: true; mfaEnrolRequired: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, password },
    });
    return { ok: true, mfaEnrolRequired: body.mfaEnrolRequired };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message, fieldErrors: error.fieldErrors };
    }
    return { error: 'Could not change the password.' };
  }
}

export async function enrolMfaAction(): Promise<{ uri: string; secret: string } | { error: string }> {
  try {
    return await apiFetch<{ uri: string; secret: string }>('/api/auth/mfa/enrol', { method: 'POST' });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Enrolment failed.' };
  }
}

export async function confirmMfaAction(
  code: string,
): Promise<{ backupCodes: string[] } | { error: string }> {
  try {
    return await apiFetch<{ backupCodes: string[] }>('/api/auth/mfa/enrol/confirm', {
      method: 'POST',
      body: { code },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'That code is not valid.' };
  }
}

export async function forgotPasswordAction(email: string): Promise<void> {
  try {
    await apiFetch('/api/auth/forgot', { method: 'POST', body: { email } });
  } catch {
    // Always look the same to the caller.
  }
}

export async function resetPasswordAction(
  token: string,
  password: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch('/api/auth/reset', { method: 'POST', body: { token, password } });
    return { ok: true };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Reset failed.' };
  }
}

export async function logoutAction(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Still send the browser to login.
  }
  redirect('/login');
}

export async function continueAfterAuth(result: LoginResultView, next?: string): Promise<never> {
  if (result.mfaRequired) redirect('/login/mfa');
  if (result.mustChangePassword) redirect('/login/change-password');
  if (result.mfaEnrolRequired) redirect('/login/mfa-enrol');
  redirect(next || result.homePath || '/');
}

export async function logoutEdmsAction(): Promise<never> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Still send the browser to the portal login.
  }
  redirect('/edms/login');
}
