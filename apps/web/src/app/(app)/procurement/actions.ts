'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { DocumentView, ProcurementView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, apiFetchForm, ApiError } from '@/lib/api';
import { withNotice } from '@/lib/notices';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = text(formData, key);
  return value === '' ? undefined : value;
}

/** `undefined` (leave unchanged) when the form has no such field; `null` when it is empty. */
function fieldOrNull(formData: FormData, key: string): string | null | undefined {
  if (!formData.has(key)) return undefined;
  return optionalText(formData, key) ?? null;
}

function optionalNumber(formData: FormData, key: string): number | undefined {
  const value = optionalText(formData, key);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseLineFields(formData: FormData): Array<{
  description: string | null;
  categoryId: string | null;
  quantity: number | null;
  unitId: string | null;
  unitPriceKobo: number | null;
  budgetLineId: string | null;
}> {
  const lines: Array<{
    description: string | null;
    categoryId: string | null;
    quantity: number | null;
    unitId: string | null;
    unitPriceKobo: number | null;
    budgetLineId: string | null;
  }> = [];
  for (let index = 0; index < 40; index += 1) {
    const prefix = `lines[${index}]`;
    const present = ['description', 'categoryId', 'quantity', 'unitId', 'unitPriceKobo', 'budgetLineId'].some((field) =>
      formData.has(`${prefix}.${field}`),
    );
    if (!present) {
      if (index === 0) continue;
      break;
    }
    lines.push({
      description: optionalText(formData, `${prefix}.description`) ?? null,
      categoryId: optionalText(formData, `${prefix}.categoryId`) ?? null,
      quantity: optionalNumber(formData, `${prefix}.quantity`) ?? null,
      unitId: optionalText(formData, `${prefix}.unitId`) ?? null,
      unitPriceKobo: optionalNumber(formData, `${prefix}.unitPriceKobo`) ?? null,
      budgetLineId: optionalText(formData, `${prefix}.budgetLineId`) ?? null,
    });
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

export async function createProcurementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: ProcurementView;
  try {
    created = await apiFetch<ProcurementView>('/api/procurement', {
      method: 'POST',
      body: {
        title: text(formData, 'title'),
        departmentId: optionalText(formData, 'departmentId'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/procurement');
  redirect(withNotice(`/procurement/${created.id}`, 'procurement-created'));
}

export async function updateProcurementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  let saved: ProcurementView;
  try {
    saved = await apiFetch<ProcurementView>(`/api/procurement/${id}`, {
      method: 'PATCH',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        title: optionalText(formData, 'title'),
        subject: fieldOrNull(formData, 'subject'),
        departmentId: fieldOrNull(formData, 'departmentId'),
        reason: fieldOrNull(formData, 'reason'),
        description: fieldOrNull(formData, 'description'),
        requiredDate: fieldOrNull(formData, 'requiredDate'),
        vendorId: fieldOrNull(formData, 'vendorId'),
        deliveryLocation: fieldOrNull(formData, 'deliveryLocation'),
        fundingSourceId: fieldOrNull(formData, 'fundingSourceId'),
        lines: parseLineFields(formData),
        projectId: fieldOrNull(formData, 'projectId'),
        urgency: optionalText(formData, 'urgency'),
        additionalInstructions: fieldOrNull(formData, 'additionalInstructions'),
        proposedPaymentTiming: fieldOrNull(formData, 'proposedPaymentTiming'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  return { status: 'ok', message: 'Draft saved.', rowVersion: saved.rowVersion };
}

export async function submitProcurementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/submit`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        idempotencyKey: `web-submit-${id}-${text(formData, 'rowVersion')}`,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  redirect(withNotice(`/procurement/${id}`, 'procurement-submitted'));
}

export async function discardProcurementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/discard`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/procurement');
  redirect(withNotice('/procurement', 'procurement-discarded'));
}

export async function attachQuotationAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  let saved: ProcurementView;
  try {
    saved = await apiFetchForm<ProcurementView>(`/api/procurement/${id}/quotations`, formData);
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Quotation added to the price comparison.', rowVersion: saved.rowVersion };
}

export async function removeQuotationAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  const quotationId = text(formData, 'quotationId');
  let saved: ProcurementView;
  try {
    saved = await apiFetch<ProcurementView>(`/api/procurement/${id}/quotations/${quotationId}/remove`, {
      method: 'POST',
      body: {},
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Quotation removed.', rowVersion: saved.rowVersion };
}

export async function selectQuotedVendorAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  let saved: ProcurementView;
  try {
    saved = await apiFetch<ProcurementView>(`/api/procurement/${id}/vendor-selection`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        vendorId: text(formData, 'vendorId'),
        justification: optionalText(formData, 'justification') ?? null,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Vendor selection saved.', rowVersion: saved.rowVersion };
}

export async function decideInvoiceVarianceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  const decision = text(formData, 'decision');
  let saved: ProcurementView;
  try {
    saved = await apiFetch<ProcurementView>(`/api/procurement/${id}/invoice-variance`, {
      method: 'POST',
      body: { decision, reason: optionalText(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  return {
    status: 'ok',
    message:
      decision === 'APPROVE'
        ? 'Invoiced amount approved. ED Finance has been notified.'
        : 'Invoiced amount rejected. The Procurement Manager has been notified.',
    rowVersion: saved.rowVersion,
  };
}

export async function attachInvoiceAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  let saved: ProcurementView;
  try {
    saved = await apiFetchForm<ProcurementView>(`/api/procurement/${id}/invoices`, formData);
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  const message =
    saved.invoiceStage === 'variance_pending'
      ? 'Invoice attached. Its amount differs from the approved total, so the MD has been asked to approve it.'
      : saved.invoiceStage === 'ready'
        ? 'Invoice attached. ED Finance has been notified.'
        : 'Invoice attached.';
  return { status: 'ok', message, rowVersion: saved.rowVersion };
}

export async function procurementWorkflowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  const action = text(formData, 'action');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/actions`, {
      method: 'POST',
      body: {
        action,
        reason: optionalText(formData, 'reason'),
        rowVersion: Number(text(formData, 'rowVersion')),
        idempotencyKey: `web-${action}-${id}-${text(formData, 'rowVersion')}`,
        finalPaymentTiming: optionalText(formData, 'finalPaymentTiming'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  revalidatePath('/');
  return { status: 'ok', message: WORKFLOW_ACTION_MESSAGES[action] ?? 'Recorded.' };
}

const WORKFLOW_ACTION_MESSAGES: Record<string, string> = {
  APPROVE: 'Approved. The request has moved to the next stage.',
  REJECT: 'Rejected. The originator has been notified.',
  RETURN_FOR_CORRECTION: 'Returned for correction.',
  ARCHIVE: 'Archived.',
  RESTORE: 'Restored.',
};

export async function cloneProcurementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  let created: ProcurementView;
  try {
    created = await apiFetch<ProcurementView>(`/api/procurement/${id}/clone`, {
      method: 'POST',
      body: {},
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/procurement');
  redirect(withNotice(`/procurement/${created.id}`, 'procurement-cloned'));
}

export async function financeDecisionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/actions`, {
      method: 'POST',
      body: {
        action: 'APPROVE',
        rowVersion: Number(text(formData, 'rowVersion')),
        idempotencyKey: `web-finance-${id}-${text(formData, 'rowVersion')}`,
        fundingRoute: text(formData, 'fundingRoute'),
        sourceAccountId: optionalText(formData, 'sourceAccountId'),
        destinationAccountId: optionalText(formData, 'destinationAccountId'),
        checklistAcknowledged: formData.get('checklistAcknowledged') === 'on',
        overrideReason: optionalText(formData, 'overrideReason'),
        reason: optionalText(formData, 'reason'),
        timingAcknowledged: formData.get('timingAcknowledged') === 'on',
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  revalidatePath('/');
  return { status: 'ok', message: 'Finance decision recorded.' };
}

export async function recordTransferAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  try {
    await apiFetchForm<ProcurementView>('/api/funding-transfers', formData);
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/');
  return { status: 'ok', message: 'Funding transfer recorded.' };
}

export async function completePaymentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetchForm<ProcurementView>(`/api/procurement/${id}/payments`, formData);
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/');
  return { status: 'ok', message: 'Payment recorded.' };
}

export async function requestPaymentReversalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  const paymentId = text(formData, 'paymentId');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/payments/${paymentId}/reverse-request`, {
      method: 'POST',
      body: { reason: text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Correction requested.' };
}

export async function approvePaymentReversalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  const paymentId = text(formData, 'paymentId');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/payments/${paymentId}/reverse-approve`, {
      method: 'POST',
      body: { reason: optionalText(formData, 'reason') ?? text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Correction approved. Record a replacement payment.' };
}

export async function recordDeliveryNoteAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/delivery-notes`, {
      method: 'POST',
      body: { note: text(formData, 'note') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Noted. Status remains awaiting delivery.' };
}

export async function recordDeliveryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  const documentKind = text(formData, 'documentKind') || 'other';
  let view: ProcurementView;
  try {
    const file = formData.get('file');
    const documents: Array<{ documentId: string; kind: string }> = [];
    if (file instanceof File && file.size > 0) {
      const upload = new FormData();
      upload.set('title', `Delivery evidence ${documentKind.replaceAll('_', ' ')}`);
      upload.set('category', documentKind);
      upload.set('context', 'procurement');
      upload.set('entityId', text(formData, 'entityId'));
      upload.set('ownerType', 'procurement_request');
      upload.set('ownerId', id);
      upload.set('file', file);
      const created = await apiFetchForm<DocumentView>('/api/documents', upload);
      documents.push({ documentId: created.id, kind: documentKind });
    }
    const items = formData
      .getAll('itemLineId')
      .map((value) => {
        const lineId = String(value);
        const field = (name: string) => optionalText(formData, `item.${lineId}.${name}`);
        const quantity = (name: string) => {
          const raw = field(name);
          if (raw === undefined) return 0;
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? parsed : 0;
        };
        const serials = field('serialCodes');
        const quantityReceived = quantity('quantityReceived');
        const quantityAccepted = quantity('quantityAccepted');
        const quantityRejected = quantity('quantityRejected');
        if (quantityReceived === 0 && quantityAccepted === 0 && quantityRejected === 0) {
          return null;
        }
        return {
          lineId,
          quantityReceived,
          quantityAccepted,
          quantityRejected,
          ...(field('rejectReason') ? { rejectReason: field('rejectReason') } : {}),
          ...(field('conditionNotes') ? { conditionNotes: field('conditionNotes') } : {}),
          ...(field('secondBatchDueOn') ? { secondBatchDueOn: field('secondBatchDueOn') } : {}),
          ...(field('batchCode') ? { batchCode: field('batchCode') } : {}),
          ...(serials
            ? {
                serialCodes: serials
                  .split(',')
                  .map((serial) => serial.trim())
                  .filter(Boolean),
              }
            : {}),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) {
      return {
        status: 'error',
        message: 'Enter the quantity received for at least one item.',
      };
    }
    const warehouseId = optionalText(formData, 'warehouseId');
    view = await apiFetch<ProcurementView>(`/api/procurement/${id}/deliveries`, {
      method: 'POST',
      body: {
        receivedDate: text(formData, 'receivedDate'),
        location: text(formData, 'location'),
        documentKind,
        ...(optionalText(formData, 'notes') ? { notes: optionalText(formData, 'notes') } : {}),
        ...(warehouseId ? { warehouseId } : {}),
        idempotencyKey: text(formData, 'idempotencyKey') || `web-del-${id}-${Date.now()}`,
        documents,
        items,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  const delivery = view.deliveries.at(-1);
  const next = view.nextAction ? ` Next: ${view.nextAction.label} (${view.nextAction.responsible}).` : '';
  return {
    status: 'ok',
    message: `Delivery ${delivery?.referenceNumber ?? ''} recorded for ${delivery?.items.length ?? 0} item(s).${next}`,
  };
}

export async function overrideShortageDeadlineAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/shortage-deadline`, {
      method: 'PATCH',
      body: {
        lineId: text(formData, 'lineId'),
        dueOn: text(formData, 'dueOn'),
        reason: text(formData, 'reason'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Second-batch date corrected.' };
}

export async function requestCloseShortAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/close-short`, {
      method: 'POST',
      body: { reason: text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Close-short sent to ED Operations.' };
}

export async function closeShortWorkflowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const instanceId = text(formData, 'instanceId');
  const requestId = text(formData, 'requestId');
  try {
    await apiFetch(`/api/workflows/${instanceId}/actions`, {
      method: 'POST',
      body: {
        action: text(formData, 'action'),
        reason: optionalText(formData, 'reason'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  if (requestId) revalidatePath(`/procurement/${requestId}`);
  revalidatePath('/workflows');
  const closeAction = text(formData, 'action');
  return {
    status: 'ok',
    message:
      closeAction === 'APPROVE'
        ? 'Close-short approved.'
        : closeAction === 'REJECT'
          ? 'Close-short rejected.'
          : 'Recorded.',
  };
}

export async function completeDeliveryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/complete`, { method: 'POST', body: {} });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  return { status: 'ok', message: 'Procurement completed.' };
}

export async function addCommentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/comments`, {
      method: 'POST',
      body: { body: text(formData, 'body') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  return { status: 'ok', message: 'Comment added.' };
}

export async function changePaymentTimingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/payment-timing`, {
      method: 'POST',
      body: {
        timing: text(formData, 'timing'),
        reason: text(formData, 'reason'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  return { status: 'ok', message: 'Payment timing updated.' };
}

export async function acknowledgePaymentTimingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'requestId');
  try {
    await apiFetch<ProcurementView>(`/api/procurement/${id}/payment-timing/ack`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/procurement/${id}`);
  revalidatePath('/procurement');
  return { status: 'ok', message: 'Payment timing acknowledged.' };
}
