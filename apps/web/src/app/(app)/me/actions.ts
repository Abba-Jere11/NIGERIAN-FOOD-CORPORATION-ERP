'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/me/profile', {
      method: 'PATCH',
      body: {
        otherNames: optional(formData, 'otherNames'),
        gender: optional(formData, 'gender'),
        personalEmail: optional(formData, 'personalEmail'),
        personalPhone: optional(formData, 'personalPhone'),
        emergencyName: optional(formData, 'emergencyName'),
        emergencyPhone: optional(formData, 'emergencyPhone'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/me/profile');
  return { status: 'ok', message: 'Profile saved.' };
}

export async function requestOwnLeave(formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/me/leave', {
      method: 'POST',
      body: {
        typeKey: text(formData, 'typeKey'),
        startsOn: text(formData, 'startsOn'),
        endsOn: text(formData, 'endsOn'),
        reason: optional(formData, 'reason'),
        reliefEmployeeId: text(formData, 'reliefEmployeeId'),
        idempotencyKey: text(formData, 'idempotencyKey') || randomUUID(),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/me/leave');
  return { status: 'ok', message: 'Leave request sent to your relief officer.' };
}

export async function markNoticeRead(id: string): Promise<void> {
  await apiFetch(`/api/me/notices/${id}/read`, { method: 'POST' });
  revalidatePath('/me/notices');
}

export async function submitComplaint(formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/me/complaints', {
      method: 'POST',
      body: {
        category: text(formData, 'category'),
        subject: text(formData, 'subject'),
        body: text(formData, 'body'),
        anonymous: formData.get('anonymous') === 'on',
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/me/complaints');
  return { status: 'ok', message: 'Your message was sent to HR.' };
}

export async function replyComplaint(formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'complaintId');
  const status = optional(formData, 'status');
  try {
    await apiFetch(`/api/hr/complaints/${id}/reply`, {
      method: 'POST',
      body: { body: text(formData, 'body'), ...(status ? { status } : {}) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/me/complaints');
  revalidatePath('/hr/complaints');
  return { status: 'ok', message: 'Reply saved.' };
}

export async function openDirect(formData: FormData): Promise<ActionResult> {
  let id = '';
  try {
    const created = await apiFetch<{ id: string }>('/api/me/messages/direct', {
      method: 'POST',
      body: { userId: text(formData, 'userId') },
    });
    id = created.id;
  } catch (error) {
    return toActionResult(error);
  }
  redirect(`/me/messages/${id}`);
}

export async function openGroup(formData: FormData): Promise<ActionResult> {
  const memberIds = text(formData, 'memberIds')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  let id = '';
  try {
    const created = await apiFetch<{ id: string }>('/api/me/messages/group', {
      method: 'POST',
      body: { title: text(formData, 'title'), memberIds },
    });
    id = created.id;
  } catch (error) {
    return toActionResult(error);
  }
  redirect(`/me/messages/${id}`);
}

export async function sendMessage(formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'conversationId');
  try {
    await apiFetch(`/api/me/messages/${id}`, {
      method: 'POST',
      body: { body: text(formData, 'body') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/me/messages/${id}`);
  return { status: 'ok', message: 'Sent.' };
}
