'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { ApiError, apiFetch } from '@/lib/api';

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

export async function createItemAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/api/inventory/items', {
      method: 'POST',
      body: {
        entityId,
        code: text(formData, 'code'),
        name: text(formData, 'name'),
        categoryId: text(formData, 'categoryId'),
        uomId: text(formData, 'uomId'),
        defaultWarehouseId: text(formData, 'defaultWarehouseId') || undefined,
        reorderLevel: Number(text(formData, 'reorderLevel') || '0'),
        trackingMode: text(formData, 'trackingMode') || 'none',
        asset: formData.get('asset') === 'on',
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/items');
  redirect(`/inventory/items/${created.id}?scope=${text(formData, 'scope')}`);
}

export async function createWarehouseAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/inventory/warehouses', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        code: text(formData, 'code'),
        name: text(formData, 'name'),
        kind: text(formData, 'kind') || 'store',
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/warehouses');
  return { status: 'ok', message: 'Warehouse saved.' };
}

export async function upsertCategoryAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/inventory/categories', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        key: text(formData, 'key'),
        name: text(formData, 'name'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/categories');
  return { status: 'ok', message: 'Category saved.' };
}

export async function issueAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    await apiFetch('/api/inventory/issues', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        warehouseId: text(formData, 'warehouseId'),
        destinationType: text(formData, 'destinationType'),
        destinationLabel: text(formData, 'destinationLabel') || undefined,
        reason: text(formData, 'reason'),
        occurredOn: text(formData, 'occurredOn'),
        idempotencyKey: text(formData, 'idempotencyKey') || `web-ist-${randomUUID()}`,
        lines: [
          {
            itemId: text(formData, 'itemId'),
            quantity: Number(text(formData, 'quantity')),
            batchCode: text(formData, 'batchCode') || undefined,
            serialCode: text(formData, 'serialCode') || undefined,
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/issues');
  revalidatePath('/inventory');
  return { status: 'ok', message: 'Stock issued.' };
}

export async function transferAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/inventory/transfers', {
      method: 'POST',
      body: {
        sourceEntityId: text(formData, 'entityId'),
        destinationEntityId: text(formData, 'destinationEntityId'),
        sourceWarehouseId: text(formData, 'sourceWarehouseId'),
        destWarehouseId: text(formData, 'destWarehouseId') || undefined,
        reason: text(formData, 'reason'),
        occurredOn: text(formData, 'occurredOn'),
        idempotencyKey: text(formData, 'idempotencyKey') || `web-itr-${randomUUID()}`,
        lines: [
          {
            itemId: text(formData, 'itemId'),
            quantity: Number(text(formData, 'quantity')),
            batchCode: text(formData, 'batchCode') || undefined,
            serialCode: text(formData, 'serialCode') || undefined,
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/transfers');
  return { status: 'ok', message: 'Transfer recorded.' };
}

export async function receiveTransferAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/transfers/${text(formData, 'id')}/receive`, {
      method: 'POST',
      body: { destWarehouseId: text(formData, 'destWarehouseId') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/transfers');
  return { status: 'ok', message: 'Transfer received.' };
}

export async function adjustmentAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/inventory/adjustments', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        warehouseId: text(formData, 'warehouseId'),
        kind: text(formData, 'kind'),
        reason: text(formData, 'reason'),
        evidenceDocumentId: text(formData, 'evidenceDocumentId') || undefined,
        occurredOn: text(formData, 'occurredOn'),
        lines: [
          {
            itemId: text(formData, 'itemId'),
            quantity: Number(text(formData, 'quantity')),
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/adjustments');
  return { status: 'ok', message: 'Adjustment submitted for approval.' };
}

export async function createCountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/api/inventory/counts', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        warehouseId: text(formData, 'warehouseId'),
        mode: text(formData, 'mode') || 'guided',
        countedOn: text(formData, 'countedOn'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/counts');
  redirect(`/inventory/counts?scope=${text(formData, 'scope')}&open=${created.id}`);
}

export async function updateCountLineAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(
      `/api/inventory/counts/${text(formData, 'countId')}/lines/${text(formData, 'lineId')}`,
      {
        method: 'PATCH',
        body: { countedQty: Number(text(formData, 'countedQty')) },
      },
    );
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/counts');
  return { status: 'ok', message: 'Count line saved.' };
}

export async function submitCountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/counts/${text(formData, 'countId')}/submit`, { method: 'POST' });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/counts');
  revalidatePath('/inventory/adjustments');
  return { status: 'ok', message: 'Count submitted. Variances await adjustment approval.' };
}

export async function createProductionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/api/inventory/production', {
      method: 'POST',
      body: {
        entityId,
        warehouseId: text(formData, 'warehouseId'),
        finishedItemId: text(formData, 'finishedItemId'),
        plannedOutputQty: Number(text(formData, 'plannedOutputQty')),
        inputs: [
          {
            itemId: text(formData, 'inputItemId'),
            warehouseId: text(formData, 'warehouseId'),
            plannedQty: Number(text(formData, 'inputQty')),
            batchCode: text(formData, 'inputBatchCode') || undefined,
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/production');
  redirect(`/inventory/production/${created.id}?scope=${text(formData, 'scope')}`);
}

export async function startProductionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/production/${text(formData, 'id')}/start`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        occurredOn: text(formData, 'occurredOn') || undefined,
        inputs: text(formData, 'inputItemId')
          ? [
              {
                itemId: text(formData, 'inputItemId'),
                actualQty: Number(text(formData, 'actualQty')),
                batchCode: text(formData, 'batchCode') || undefined,
              },
            ]
          : undefined,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/production');
  return { status: 'ok', message: 'Production started. Raw materials moved to WIP.' };
}

export async function completeProductionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/production/${text(formData, 'id')}/complete`, {
      method: 'POST',
      body: {
        rowVersion: Number(text(formData, 'rowVersion')),
        actualOutputQty: Number(text(formData, 'actualOutputQty')),
        wasteQty: Number(text(formData, 'wasteQty') || '0'),
        wasteReason: text(formData, 'wasteReason') || undefined,
        finishedBatchCode: text(formData, 'finishedBatchCode'),
        producedOn: text(formData, 'producedOn'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/production');
  return { status: 'ok', message: 'Submitted for completion approval.' };
}

export async function cancelProductionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/production/${text(formData, 'id')}/cancel`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')), reason: text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/production');
  return { status: 'ok', message: 'Production cancelled.' };
}

export async function createSalesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const entityId = text(formData, 'entityId');
  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/api/inventory/sales', {
      method: 'POST',
      body: {
        entityId,
        customerId: text(formData, 'customerId'),
        terms: text(formData, 'terms') || undefined,
        dueOn: text(formData, 'dueOn') || undefined,
        occurredOn: text(formData, 'occurredOn'),
        lines: [
          {
            itemId: text(formData, 'itemId'),
            warehouseId: text(formData, 'warehouseId'),
            quantity: Number(text(formData, 'quantity')),
            unitPriceKobo: Number(text(formData, 'unitPriceKobo')),
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/sales');
  redirect(`/inventory/sales/${created.id}?scope=${text(formData, 'scope')}`);
}

export async function submitSalesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/sales/${text(formData, 'id')}/submit`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/sales');
  return { status: 'ok', message: 'Sales order submitted for approval.' };
}

export async function cancelSalesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/sales/${text(formData, 'id')}/cancel`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')), reason: text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/sales');
  return { status: 'ok', message: 'Sales order cancelled.' };
}

export async function dispatchSalesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/sales/${text(formData, 'id')}/dispatch`, {
      method: 'POST',
      body: {
        vehicle: text(formData, 'vehicle') || undefined,
        driver: text(formData, 'driver') || undefined,
        destination: text(formData, 'destination'),
        occurredOn: text(formData, 'occurredOn'),
        documentId: text(formData, 'documentId') || undefined,
        lines: [
          {
            orderLineId: text(formData, 'orderLineId'),
            quantity: Number(text(formData, 'quantity')),
            batchCode: text(formData, 'batchCode') || undefined,
          },
        ],
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/sales');
  revalidatePath('/inventory/sales/dispatches');
  return { status: 'ok', message: 'Dispatch recorded.' };
}

export async function invoiceSalesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/sales/${text(formData, 'id')}/invoice`, {
      method: 'POST',
      body: {
        occurredOn: text(formData, 'occurredOn') || undefined,
        dueOn: text(formData, 'dueOn') || undefined,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/sales');
  revalidatePath('/inventory/sales/invoices');
  return { status: 'ok', message: 'Receivables invoice raised.' };
}

export async function returnSalesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/inventory/sales/${text(formData, 'id')}/return`, {
      method: 'POST',
      body: {
        dispatchId: text(formData, 'dispatchId') || undefined,
        reason: text(formData, 'reason'),
        occurredOn: text(formData, 'occurredOn'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/inventory/sales');
  return { status: 'ok', message: 'Sales return posted.' };
}
