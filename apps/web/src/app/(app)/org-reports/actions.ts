'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { OrgMinuteView, OrgReportView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, apiFetchForm, ApiError } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optional(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value === '' ? null : value;
}

function omitBlank(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
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

function revalidateReport(id: string): void {
  revalidatePath('/org-reports');
  revalidatePath('/org-reports/mine');
  revalidatePath('/org-reports/incoming');
  revalidatePath(`/org-reports/${id}`);
}

export async function createReportAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const submit = text(formData, 'intent') === 'submit';
  let created: OrgReportView;
  try {
    created = await apiFetch<OrgReportView>('/api/org-reports', {
      method: 'POST',
      body: omitBlank({
        entityId: text(formData, 'entityId'),
        templateKey: text(formData, 'templateKey'),
        title: text(formData, 'title'),
        body: text(formData, 'body'),
        observations: optional(formData, 'observations'),
        reportingPeriod: optional(formData, 'reportingPeriod'),
        reportDate: optional(formData, 'reportDate'),
        ccUserIds: formData.getAll('ccUserIds').map(String).filter(Boolean),
        idempotencyKey: text(formData, 'idempotencyKey'),
      }),
    });
    if (submit) {
      created = await apiFetch<OrgReportView>(`/api/org-reports/${created.id}/submit`, {
        method: 'POST',
        body: { idempotencyKey: `${text(formData, 'idempotencyKey')}-submit`, rowVersion: created.rowVersion },
      });
    }
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(created.id);
  redirect(submit ? `/org-reports/${created.id}?submitted=1` : `/org-reports/${created.id}`);
}

export async function saveDraftAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<OrgReportView>(`/api/org-reports/${id}`, {
      method: 'PATCH',
      body: omitBlank({
        title: text(formData, 'title'),
        body: text(formData, 'body'),
        observations: optional(formData, 'observations'),
        reportingPeriod: optional(formData, 'reportingPeriod'),
        reportDate: optional(formData, 'reportDate'),
        ccUserIds: formData.getAll('ccUserIds').map(String).filter(Boolean),
        rowVersion: Number(text(formData, 'rowVersion')),
      }),
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  return { status: 'ok', message: 'Draft saved.' };
}

export async function submitReportAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<OrgReportView>(`/api/org-reports/${id}/submit`, {
      method: 'POST',
      body: {
        idempotencyKey: text(formData, 'idempotencyKey'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  redirect(`/org-reports/${id}?submitted=1`);
}

export async function amendReportAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<OrgReportView>(`/api/org-reports/${id}/amend`, {
      method: 'POST',
      body: {
        title: optional(formData, 'title'),
        body: optional(formData, 'body'),
        observations: optional(formData, 'observations'),
        reason: text(formData, 'reason'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  return { status: 'ok', message: 'The amendment was recorded against the original.' };
}

export async function forwardReportAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<OrgReportView>(`/api/org-reports/${id}/forward`, {
      method: 'POST',
      body: {
        userIds: formData.getAll('userIds').map(String).filter(Boolean),
        note: optional(formData, 'note'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  return { status: 'ok', message: 'The report was forwarded for information. This does not assign work.' };
}

export async function closeReportAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<OrgReportView>(`/api/org-reports/${id}/close`, {
      method: 'POST',
      body: { status: text(formData, 'status'), rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  return { status: 'ok', message: 'The report status was updated. Linked minutes were not closed.' };
}

export async function issueMinuteAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const reportId = text(formData, 'reportId');
  try {
    const created = await apiFetch<OrgMinuteView>(`/api/org-reports/${reportId}/minutes`, {
      method: 'POST',
      body: {
        subject: text(formData, 'subject'),
        instruction: text(formData, 'instruction'),
        expectedOutcome: optional(formData, 'expectedOutcome'),
        dueAt: optional(formData, 'dueAt'),
        responseRequired: text(formData, 'responseRequired') !== 'no',
        acknowledgementRequired: text(formData, 'acknowledgementRequired') === 'yes',
        priority: text(formData, 'priority') || 'NORMAL',
        toUserId: text(formData, 'toUserId'),
        ccUserIds: formData.getAll('ccUserIds').map(String).filter(Boolean),
        idempotencyKey: text(formData, 'idempotencyKey'),
      },
    });
    if (text(formData, 'intent') !== 'draft') {
      await apiFetch<OrgMinuteView>(`/api/org-reports/minutes/${created.id}/issue`, {
        method: 'POST',
        body: { rowVersion: created.rowVersion, idempotencyKey: `${text(formData, 'idempotencyKey')}-issue` },
      });
      revalidatePath('/org-reports/minutes');
      revalidateReport(reportId);
      redirect(`/org-reports/minutes/${created.id}`);
    }
    revalidateReport(reportId);
    redirect(`/org-reports/minutes/${created.id}`);
  } catch (error) {
    return toActionResult(error);
  }
}

export async function minuteWorkflowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  const path = text(formData, 'path');
  try {
    await apiFetch<OrgMinuteView>(`/api/org-reports/minutes/${id}/${path}`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/org-reports/minutes/${id}`);
  return { status: 'ok', message: 'The minute was updated.' };
}

export async function submitResponseAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    const file = formData.get('file');
    const created = await apiFetch<OrgMinuteView>(`/api/org-reports/minutes/${id}/responses`, {
      method: 'POST',
      body: {
        subject: text(formData, 'subject'),
        body: text(formData, 'body'),
        outcome: optional(formData, 'outcome'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      },
    });
    const response = created.responses.at(-1);
    if (file instanceof File && file.size > 0 && response) {
      const upload = new FormData();
      upload.set('title', file.name);
      upload.set('category', 'org-response');
      upload.set('context', 'general');
      upload.set('entityId', text(formData, 'entityId'));
      upload.set('ownerType', 'org_response');
      upload.set('ownerId', response.id);
      upload.set('file', file);
      await apiFetchForm('/api/documents', upload);
    }
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/org-reports/minutes/${id}`);
  return { status: 'ok', message: 'The response is now an official record.' };
}

export async function reviewResponseAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<OrgMinuteView>(`/api/org-reports/minutes/${id}/review`, {
      method: 'POST',
      body: {
        action: text(formData, 'action'),
        note: optional(formData, 'note'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/org-reports/minutes/${id}`);
  return { status: 'ok', message: 'The review was recorded. Previous responses were kept.' };
}

export async function recordDecisionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/org-reports/${id}/decisions`, {
      method: 'POST',
      body: {
        subject: text(formData, 'subject'),
        body: text(formData, 'body'),
        minuteId: optional(formData, 'minuteId'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  return { status: 'ok', message: 'The management decision was recorded separately from any minute.' };
}

export async function sendExternalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/org-reports/${id}/email`, {
      method: 'POST',
      body: {
        recipientEmail: text(formData, 'recipientEmail'),
        subject: text(formData, 'subject'),
        message: text(formData, 'message'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidateReport(id);
  return { status: 'ok', message: 'The external correspondence record was stored.' };
}

export async function uploadAttachmentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ownerId = text(formData, 'ownerId');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a file to attach.' };
  }
  try {
    const upload = new FormData();
    upload.set('title', file.name);
    upload.set('category', 'org-report');
    upload.set('context', 'general');
    upload.set('entityId', text(formData, 'entityId'));
    upload.set('ownerType', text(formData, 'ownerType') || 'org_report');
    upload.set('ownerId', ownerId);
    upload.set('file', file);
    await apiFetchForm('/api/documents', upload);
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/org-reports/${ownerId}`);
  revalidatePath(`/org-reports/minutes/${ownerId}`);
  return { status: 'ok', message: 'The attachment was stored with this record.' };
}

export async function updateTemplateAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/org-reports/templates/${text(formData, 'id')}`, {
      method: 'PATCH',
      body: {
        title: optional(formData, 'title'),
        available: text(formData, 'available') === 'yes',
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/org-reports/admin/templates');
  return { status: 'ok', message: 'Template updated. This does not grant business approval powers.' };
}
