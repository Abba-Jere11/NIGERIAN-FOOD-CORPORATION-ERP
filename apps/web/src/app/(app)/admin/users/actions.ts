'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api';

export async function setUserMfaPolicyAction(
  userId: string,
  required: boolean,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/admin/users/${userId}/mfa-policy`, {
      method: 'POST',
      body: { required, reason },
    });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not update MFA policy.' };
  }
}
