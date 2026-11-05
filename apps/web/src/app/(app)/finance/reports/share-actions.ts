'use server';

import type { ActionResult } from '@/lib/action-result';
import { apiFetch, ApiError } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

export async function shareReportAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const kind = text(formData, 'kind');
  const ytd = formData.get('ytd') === 'true';
  const consolidated = formData.get('consolidated') === 'true';
  try {
    const result = await apiFetch<{ id: string; status: string; subject: string }>(
      `/api/finance/reports/${kind}/email`,
      {
        method: 'POST',
        body: {
          recipient: text(formData, 'recipient'),
          message: text(formData, 'message') || undefined,
          entityId: text(formData, 'entityId') || undefined,
          consolidated: consolidated || undefined,
          periodId: text(formData, 'periodId') || undefined,
          year: text(formData, 'year') ? Number(text(formData, 'year')) : undefined,
          ytd: ytd || undefined,
        },
      },
    );
    const sent = result.status === 'sent';
    return {
      status: 'ok',
      message: sent
        ? 'The report was sent from the Managing Director’s official mailbox.'
        : 'The report was queued. Configure SMTP to deliver it to the recipient.',
    };
  } catch (error) {
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
}
