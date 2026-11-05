'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { RequisitionView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, ApiError } from '@/lib/api';
import { withNotice } from '@/lib/notices';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = text(formData, key);
  return value === '' ? undefined : value;
}

function optionalNumber(formData: FormData, key: string): number | undefined {
  const value = optionalText(formData, key);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseLines(formData: FormData): Array<{ description: string; quantity: number; unitId: string }> {
  const lines: Array<{ description: string; quantity: number; unitId: string }> = [];
  for (let index = 0; index < 40; index += 1) {
    const prefix = `lines[${index}]`;
    const present = ['description', 'quantity', 'unitId'].some((field) => formData.has(`${prefix}.${field}`));
    if (!present) {
      if (index === 0) continue;
      break;
    }
    const description = optionalText(formData, `${prefix}.description`);
    const quantity = optionalNumber(formData, `${prefix}.quantity`);
    const unitId = optionalText(formData, `${prefix}.unitId`);
    if (!description || !quantity || !unitId) continue;
    lines.push({ description, quantity, unitId });
  }
  return lines;
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

export async function createRequisitionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: RequisitionView;
  try {
    created = await apiFetch<RequisitionView>('/api/requisitions', {
      method: 'POST',
      body: {
        title: text(formData, 'title'),
        departmentId: optionalText(formData, 'departmentId'),
        entityId: optionalText(formData, 'entityId'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/requisitions');
  redirect(withNotice(`/requisitions/${created.id}`, 'requisition-created'));
}

export async function updateRequisitionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  let saved: RequisitionView;
  try {
    saved = await apiFetch<RequisitionView>(`/api/requisitions/${id}`, {
      method: 'PATCH',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        title: optionalText(formData, 'title'),
        departmentId: optionalText(formData, 'departmentId') ?? null,
        categoryId: optionalText(formData, 'categoryId') ?? null,
        background: optionalText(formData, 'background') ?? null,
        justification: optionalText(formData, 'justification') ?? null,
        prayer: optionalText(formData, 'prayer') ?? null,
        requiredDate: optionalText(formData, 'requiredDate') ?? null,
        deliveryLocation: optionalText(formData, 'deliveryLocation') ?? null,
        urgency: optionalText(formData, 'urgency'),
        lines: parseLines(formData),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/requisitions/${id}`);
  revalidatePath('/requisitions');
  return { status: 'ok', message: 'Draft saved.', rowVersion: saved.rowVersion };
}

export async function submitRequisitionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<RequisitionView>(`/api/requisitions/${id}/submit`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        idempotencyKey: `web-req-submit-${id}-${text(formData, 'rowVersion')}`,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/requisitions/${id}`);
  revalidatePath('/requisitions');
  redirect(withNotice(`/requisitions/${id}`, 'requisition-submitted'));
}

export async function discardRequisitionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<RequisitionView>(`/api/requisitions/${id}/discard`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/requisitions');
  redirect(withNotice('/requisitions', 'requisition-discarded'));
}
