'use server';

import { revalidatePath } from 'next/cache';
import type { DepartmentView, EntityView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Server actions for entity and department administration.
 *
 * They are thin on purpose. Validation, permission checks, optimistic locking
 * and the audit entry all happen in the API inside one transaction, so these
 * functions only translate the API's answer into something the form can render.
 * Nothing here is trusted by the server.
 */
function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = text(formData, key);
  return value === '' ? undefined : value;
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

export async function createEntity(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const entity = await apiFetch<EntityView>('/api/entities', {
      method: 'POST',
      body: {
        code: text(formData, 'code').toUpperCase(),
        name: text(formData, 'name'),
        legalName: text(formData, 'legalName') || text(formData, 'name'),
        type: 'SUBSIDIARY',
      },
    });
    revalidatePath('/admin/entities');
    revalidatePath('/');
    return { status: 'ok', message: `${entity.code} created.` };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateEntity(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<EntityView>(`/api/entities/${id}`, {
      method: 'PATCH',
      body: {
        name: text(formData, 'name'),
        legalName: text(formData, 'legalName') || text(formData, 'name'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
    revalidatePath('/admin/entities');
    revalidatePath(`/admin/entities/${id}`);
    return { status: 'ok', message: 'Changes saved.' };
  } catch (error) {
    return toActionResult(error);
  }
}

/** Deactivation, never deletion (rule R3), and always with a reason (rule R11). */
export async function setEntityStatus(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  const target = text(formData, 'target') === 'ACTIVE' ? 'activate' : 'deactivate';
  try {
    await apiFetch<EntityView>(`/api/entities/${id}/${target}`, {
      method: 'POST',
      body: { reason: text(formData, 'reason'), rowVersion: Number(text(formData, 'rowVersion')) },
    });
    revalidatePath('/admin/entities');
    revalidatePath(`/admin/entities/${id}`);
    revalidatePath('/');
    return { status: 'ok', message: target === 'activate' ? 'Reactivated.' : 'Deactivated.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function createDepartment(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  try {
    const department = await apiFetch<DepartmentView>(`/api/entities/${entityId}/departments`, {
      method: 'POST',
      body: {
        name: text(formData, 'name'),
        code: optionalText(formData, 'code')?.toUpperCase(),
        description: optionalText(formData, 'description'),
      },
    });
    revalidatePath(`/admin/entities/${entityId}`);
    revalidatePath('/admin/entities');
    return { status: 'ok', message: `${department.name} created.` };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateDepartment(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  try {
    await apiFetch<DepartmentView>(`/api/departments/${text(formData, 'id')}`, {
      method: 'PATCH',
      body: {
        name: text(formData, 'name'),
        code: optionalText(formData, 'code')?.toUpperCase(),
        description: optionalText(formData, 'description'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
    revalidatePath(`/admin/entities/${entityId}`);
    return { status: 'ok', message: 'Changes saved.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function setDepartmentStatus(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  const target = text(formData, 'target') === 'ACTIVE' ? 'activate' : 'deactivate';
  try {
    await apiFetch<DepartmentView>(`/api/departments/${text(formData, 'id')}/${target}`, {
      method: 'POST',
      body: { reason: text(formData, 'reason'), rowVersion: Number(text(formData, 'rowVersion')) },
    });
    revalidatePath(`/admin/entities/${entityId}`);
    revalidatePath('/admin/entities');
    return { status: 'ok', message: target === 'activate' ? 'Reactivated.' : 'Deactivated.' };
  } catch (error) {
    return toActionResult(error);
  }
}
