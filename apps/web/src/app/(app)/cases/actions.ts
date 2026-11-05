'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CaseView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, ApiError } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function toActionResult(error: unknown): ActionResult {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      message: error.message,
      ...(Object.keys(error.fieldErrors).length > 0 ? { fieldErrors: error.fieldErrors } : {}),
      requestId: error.requestId,
    };
  }
  return {
    status: 'error',
    message: error instanceof Error ? error.message : 'Something went wrong.',
  };
}

function revalidateCase(id: string): void {
  revalidatePath('/cases');
  revalidatePath(`/cases/${id}`);
}

export async function createCaseAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: CaseView;
  try {
    created = await apiFetch<CaseView>('/api/cases', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        title: text(formData, 'title'),
        body: text(formData, 'body'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/cases');
  redirect(`/cases/${created.id}`);
}

export async function addCaseAccessAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  const kind = text(formData, 'kind');
  const path =
    kind === 'ASSIGNEE' ? 'assign' : kind === 'CC' ? 'cc' : kind === 'GRANT' ? 'grant' : '';
  if (!path) return { status: 'error', message: 'Choose assign, grant or CC.' };
  try {
    await apiFetch<CaseView>(`/api/cases/${id}/${path}`, {
      method: 'POST',
      body: { userId: text(formData, 'userId') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateCase(id);
  return { status: 'ok', message: 'Access was updated.' };
}

export async function addCaseCommentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<CaseView>(`/api/cases/${id}/comments`, {
      method: 'POST',
      body: { body: text(formData, 'body') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateCase(id);
  return { status: 'ok', message: 'Comment saved.' };
}

export async function setCaseStatusAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<CaseView>(`/api/cases/${id}/status`, {
      method: 'POST',
      body: { status: text(formData, 'status') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateCase(id);
  return { status: 'ok', message: 'Status updated.' };
}
