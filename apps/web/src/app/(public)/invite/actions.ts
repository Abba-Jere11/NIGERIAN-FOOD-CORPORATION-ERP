'use server';

import type { ActionResult } from '@/lib/action-result';
import { ApiError, apiFetch } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optional(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value === '' ? null : value;
}

export async function registerWithInvite(token: string, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch(`/api/public/invites/${encodeURIComponent(token)}/register`, {
      method: 'POST',
      body: {
        password: text(formData, 'password'),
        otherNames: optional(formData, 'otherNames'),
        gender: optional(formData, 'gender'),
        personalPhone: optional(formData, 'personalPhone'),
        emergencyName: optional(formData, 'emergencyName'),
        emergencyPhone: optional(formData, 'emergencyPhone'),
        bankName: optional(formData, 'bankName'),
        bankAccountName: optional(formData, 'bankAccountName'),
        bankAccountNumber: optional(formData, 'bankAccountNumber'),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors, requestId: error.requestId };
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' };
  }
  return { status: 'ok', message: 'Your account is waiting for HR to approve access. You can sign in after that.' };
}
