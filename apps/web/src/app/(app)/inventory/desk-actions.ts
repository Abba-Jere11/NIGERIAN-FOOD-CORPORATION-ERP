'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { DocumentView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { ApiError, apiFetch, apiFetchForm } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optional(formData: FormData, key: string): string | undefined {
  return text(formData, key) || undefined;
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

async function uploadEvidence(
  formData: FormData,
  field: string,
  input: { title: string; entityId: string; category: string },
): Promise<string | undefined> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return undefined;
  const upload = new FormData();
  upload.set('title', input.title);
  upload.set('category', input.category);
  upload.set('context', 'general');
  upload.set('entityId', input.entityId);
  upload.set('file', file);
  const created = await apiFetchForm<DocumentView>('/api/documents', upload);
  return created.id;
}

export async function qcDecisionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const decision = text(formData, 'decision');
  try {
    await apiFetch('/api/inventory/qc', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        itemId: text(formData, 'itemId'),
        warehouseId: text(formData, 'warehouseId'),
        batchId: optional(formData, 'batchId'),
        serialId: optional(formData, 'serialId'),
        grnId: optional(formData, 'grnId'),
        productionOrderId: optional(formData, 'productionOrderId'),
        returnId: optional(formData, 'returnId'),
        decision,
        quantity: Number(text(formData, 'quantity')),
        reason: text(formData, 'reason'),
        occurredOn: text(formData, 'occurredOn'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/qc');
  revalidatePath('/inventory');
  return { status: 'ok', message: decision === 'RELEASE' ? 'Released to available stock.' : 'Rejected.' };
}

export async function stockReturnAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const kind = text(formData, 'kind');
  try {
    await apiFetch('/api/inventory/returns', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        warehouseId: text(formData, 'warehouseId'),
        kind,
        vendorId: optional(formData, 'vendorId'),
        grnId: optional(formData, 'grnId'),
        returnedByName: optional(formData, 'returnedByName'),
        departmentLabel: optional(formData, 'departmentLabel'),
        reason: text(formData, 'reason'),
        occurredOn: text(formData, 'occurredOn'),
        idempotencyKey: text(formData, 'idempotencyKey') || `web-ret-${randomUUID()}`,
        lines: [
          {
            itemId: text(formData, 'itemId'),
            quantity: Number(text(formData, 'quantity')),
            fromStatus: kind === 'SUPPLIER_RETURN' ? optional(formData, 'fromStatus') : undefined,
            batchCode: optional(formData, 'batchCode'),
            serialCode: optional(formData, 'serialCode'),
            issueId: optional(formData, 'issueId'),
            issueLineId: optional(formData, 'issueLineId'),
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/returns');
  revalidatePath('/inventory/qc');
  return {
    status: 'ok',
    message: kind === 'SUPPLIER_RETURN' ? 'Returned to the supplier.' : 'Return received into quarantine.',
  };
}

export async function countAdjustmentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const lines = JSON.parse(text(formData, 'lines') || '[]') as Array<{ itemId: string; quantity: number }>;
    await apiFetch('/api/inventory/adjustments', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        warehouseId: text(formData, 'warehouseId'),
        kind: 'count_variance',
        countId: text(formData, 'countId'),
        reason: text(formData, 'reason'),
        occurredOn: text(formData, 'occurredOn'),
        idempotencyKey: `web-adj-${text(formData, 'countId')}`,
        lines,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/counts');
  revalidatePath('/inventory/adjustments');
  return { status: 'ok', message: 'Adjustment sent for approval.' };
}

export async function disposalAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  try {
    const evidenceDocumentId = await uploadEvidence(formData, 'evidence', {
      title: 'Disposal evidence',
      entityId,
      category: 'inventory_disposal',
    });
    await apiFetch('/api/inventory/adjustments', {
      method: 'POST',
      body: {
        entityId,
        warehouseId: text(formData, 'warehouseId'),
        kind: text(formData, 'kind') || 'disposal',
        reason: text(formData, 'reason'),
        evidenceDocumentId,
        occurredOn: text(formData, 'occurredOn'),
        idempotencyKey: `web-dsp-${randomUUID()}`,
        lines: [
          {
            itemId: text(formData, 'itemId'),
            quantity: Number(text(formData, 'quantity')),
            stockStatus: optional(formData, 'stockStatus'),
            batchCode: optional(formData, 'batchCode'),
            serialCode: optional(formData, 'serialCode'),
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/adjustments');
  return { status: 'ok', message: 'Disposal sent for approval.' };
}

export async function registerAssetAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  try {
    const photoDocumentId = await uploadEvidence(formData, 'photo', {
      title: 'Asset photo',
      entityId,
      category: 'asset_photo',
    });
    const cost = text(formData, 'costNaira');
    await apiFetch('/api/inventory/assets', {
      method: 'POST',
      body: {
        entityId,
        itemId: text(formData, 'itemId'),
        serialCode: optional(formData, 'serialCode'),
        warehouseId: optional(formData, 'warehouseId'),
        locationLabel: optional(formData, 'locationLabel'),
        condition: text(formData, 'condition') || 'good',
        costKobo: cost ? Math.round(Number(cost) * 100) : 0,
        acquiredOn: optional(formData, 'acquiredOn'),
        photoDocumentId,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/assets');
  return { status: 'ok', message: 'Asset registered.' };
}

export async function moveAssetAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/inventory/assets/${id}/move`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        kind: text(formData, 'kind') || 'MOVED',
        departmentLabel: optional(formData, 'departmentLabel'),
        locationLabel: optional(formData, 'locationLabel'),
        custodianName: optional(formData, 'custodianName'),
        condition: optional(formData, 'condition'),
        reason: text(formData, 'reason'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/inventory/assets/${id}`);
  return { status: 'ok', message: 'Asset updated.' };
}

export async function assetPhotoAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    const documentId = await uploadEvidence(formData, 'photo', {
      title: 'Asset photo',
      entityId: text(formData, 'entityId'),
      category: 'asset_photo',
    });
    if (!documentId) return { status: 'error', message: 'Choose a photo to upload.' };
    await apiFetch(`/api/inventory/assets/${id}/photo`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')), documentId },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/inventory/assets/${id}`);
  revalidatePath('/inventory/scan');
  return { status: 'ok', message: 'Photo saved.' };
}

export async function clearAssetPhotoAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/inventory/assets/${id}/photo`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')), documentId: null },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/inventory/assets/${id}`);
  revalidatePath('/inventory/scan');
  return { status: 'ok', message: 'Photo removed.' };
}

export async function disposeAssetAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    const evidenceDocumentId = await uploadEvidence(formData, 'evidence', {
      title: 'Asset disposal evidence',
      entityId: text(formData, 'entityId'),
      category: 'inventory_disposal',
    });
    await apiFetch(`/api/inventory/assets/${id}/dispose`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        reason: text(formData, 'reason'),
        evidenceDocumentId,
        occurredOn: text(formData, 'occurredOn'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/inventory/assets/${id}`);
  return { status: 'ok', message: 'Disposal sent for approval.' };
}

export async function closeProductionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/inventory/production/${id}/close`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')), note: optional(formData, 'note') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/inventory/production/${id}`);
  return { status: 'ok', message: 'Production order closed.' };
}

export async function updateBatchAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/inventory/batches/${id}`, {
      method: 'PATCH',
      body: {
        manufacturedOn: optional(formData, 'manufacturedOn') ?? null,
        expiresOn: optional(formData, 'expiresOn') ?? null,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/batches');
  return { status: 'ok', message: 'Batch dates saved.' };
}

export async function createFormulaAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const inputs = formData
      .getAll('inputItemId')
      .map((value, index) => ({
        itemId: String(value),
        kind: 'INPUT' as const,
        quantity: Number(formData.getAll('inputQty')[index] ?? 0),
      }))
      .filter((line) => line.itemId && line.quantity > 0);
    await apiFetch('/api/inventory/formulas', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        code: text(formData, 'code'),
        name: text(formData, 'name'),
        finishedItemId: text(formData, 'finishedItemId'),
        baseOutputQty: Number(text(formData, 'baseOutputQty')),
        lines: inputs,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/production/formulas');
  return { status: 'ok', message: 'Formula saved.' };
}
