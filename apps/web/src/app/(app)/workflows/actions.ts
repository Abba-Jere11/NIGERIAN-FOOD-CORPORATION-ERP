'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, ApiError } from '@/lib/api';

export async function workflowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const instanceId = String(formData.get('instanceId') ?? '');
  const action = String(formData.get('action') ?? '');
  const reason = String(formData.get('reason') ?? '');
  const rowVersion = Number(formData.get('rowVersion'));
  try {
    if (action === 'RESUBMIT') {
      await apiFetch(`/api/workflows/${instanceId}/resubmit`, {
        method: 'POST',
        body: { rowVersion },
      });
    } else {
      await apiFetch(`/api/workflows/${instanceId}/actions`, {
        method: 'POST',
        body: { action, reason: reason || undefined, rowVersion },
      });
    }
    revalidatePath('/workflows');
    revalidatePath(`/workflows/${instanceId}`);
    revalidatePath('/finance/journals');
    revalidatePath('/finance/budgets');
    revalidatePath('/inventory/production');
    revalidatePath('/inventory/sales');
    revalidatePath('/hr');
    revalidatePath('/home/hr');
    revalidatePath('/home/md');
    return { status: 'ok', message: 'Recorded.' };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors, requestId: error.requestId };
    }
    throw error;
  }
}

export async function submitFixtureAction(): Promise<void> {
  const { PR_2026_000184_SUBJECT_ID } = await import('@nfc/shared');
  try {
    await apiFetch(`/api/workflows/subjects/${PR_2026_000184_SUBJECT_ID}/submit`, {
      method: 'POST',
      body: {},
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(error.message);
    }
    throw error;
  }
  revalidatePath('/workflows');
}
