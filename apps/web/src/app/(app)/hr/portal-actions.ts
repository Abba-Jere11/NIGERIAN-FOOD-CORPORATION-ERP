'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { ApiError, apiFetch } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optional(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value === '' ? null : value;
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

export async function issueInvite(employeeId: string): Promise<ActionResult> {
  try {
    const invite = await apiFetch<{ link: string; email: string }>(`/api/hr/employees/${employeeId}/invite`, {
      method: 'POST',
    });
    revalidatePath(`/hr/employees/${employeeId}`);
    revalidatePath('/hr/access');
    return { status: 'ok', message: `Invite sent to ${invite.email}. Link: ${invite.link}` };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function linkEmployeeUser(formData: FormData): Promise<ActionResult> {
  const employeeId = text(formData, 'employeeId');
  try {
    await apiFetch(`/api/hr/employees/${employeeId}/link-user`, {
      method: 'POST',
      body: { userId: text(formData, 'userId') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/hr/employees/${employeeId}`);
  return { status: 'ok', message: 'This employee is linked to that account.' };
}

export async function setDepartmentHead(formData: FormData): Promise<ActionResult> {
  const departmentId = text(formData, 'departmentId');
  try {
    await apiFetch(`/api/hr/departments/${departmentId}/head`, {
      method: 'POST',
      body: { employeeId: text(formData, 'employeeId') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  return { status: 'ok', message: 'Department head saved.' };
}

export async function decideInvite(formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'inviteId');
  const approve = text(formData, 'decision') === 'approve';
  try {
    await apiFetch(`/api/hr/invites/${id}/${approve ? 'approve' : 'reject'}`, {
      method: 'POST',
      body: { reason: text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/hr/access');
  return { status: 'ok', message: approve ? 'Access approved.' : 'Access rejected.' };
}

export async function publishNotice(formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/hr/notices', {
      method: 'POST',
      body: {
        title: text(formData, 'title'),
        body: text(formData, 'body'),
        entityId: optional(formData, 'entityId'),
        pinned: formData.get('pinned') === 'on',
        audience: { all: true },
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/hr/notices');
  revalidatePath('/me/notices');
  return { status: 'ok', message: 'Notice published.' };
}
