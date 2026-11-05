'use server';

import { revalidatePath } from 'next/cache';
import type { BudgetLineView, ProjectView } from '@nfc/shared';
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
  return { status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' };
}

export async function createBudgetLineAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch<BudgetLineView>('/api/budget-lines', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        fiscalYear: Number.parseInt(text(formData, 'fiscalYear'), 10),
        code: text(formData, 'code'),
        name: text(formData, 'name'),
        approvedAmountKobo: Number.parseInt(text(formData, 'approvedAmountKobo'), 10),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/budget-lines');
  return { status: 'ok', message: 'Budget line created.' };
}

export async function createProjectAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch<ProjectView>('/api/projects', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        code: text(formData, 'code'),
        name: text(formData, 'name'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/budget-lines');
  return { status: 'ok', message: 'Project created.' };
}
