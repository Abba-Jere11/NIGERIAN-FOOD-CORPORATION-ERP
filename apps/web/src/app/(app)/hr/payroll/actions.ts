'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PayrollRunView, PayrollStructureView } from '@nfc/shared';
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

function revalidatePayroll(): void {
  revalidatePath('/hr/payroll');
  revalidatePath('/hr/reports');
  revalidatePath('/home/hr');
  revalidatePath('/home/ed-finance');
  revalidatePath('/home/finance-head');
}

export async function createStructureAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const created = await apiFetch<PayrollStructureView>('/api/payroll/structures', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        employeeId: optional(formData, 'employeeId'),
        basicKobo: Number(text(formData, 'basicKobo')),
        effectiveOn: text(formData, 'effectiveOn'),
        allowances: [],
      },
    });
    revalidatePayroll();
    redirect(`/hr/payroll?structure=${created.id}`);
  } catch (error) {
    return toActionResult(error);
  }
}

export async function confirmStructureAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/payroll/structures/${text(formData, 'id')}/confirm`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
    revalidatePayroll();
    return { status: 'ok', message: 'Salary structure confirmed.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function createRunAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const created = await apiFetch<PayrollRunView>('/api/payroll/runs', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        fiscalPeriodId: text(formData, 'fiscalPeriodId'),
        idempotencyKey: text(formData, 'idempotencyKey'),
      },
    });
    revalidatePayroll();
    redirect(`/hr/payroll/${created.id}`);
  } catch (error) {
    return toActionResult(error);
  }
}

export async function calculateRunAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = text(formData, 'id');
    await apiFetch(`/api/payroll/runs/${id}/calculate`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
    revalidatePayroll();
    revalidatePath(`/hr/payroll/${id}`);
    return { status: 'ok', message: 'Run calculated.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function submitRunAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = text(formData, 'id');
    await apiFetch(`/api/payroll/runs/${id}/submit`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
    revalidatePayroll();
    revalidatePath(`/hr/payroll/${id}`);
    return { status: 'ok', message: 'Run submitted for approval.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function payRunAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = text(formData, 'id');
    await apiFetch(`/api/payroll/runs/${id}/pay`, {
      method: 'POST',
      body: {
        evidenceDocumentId: text(formData, 'evidenceDocumentId'),
        rowVersion: Number(text(formData, 'rowVersion')),
        idempotencyKey: text(formData, 'idempotencyKey'),
      },
    });
    revalidatePayroll();
    revalidatePath(`/hr/payroll/${id}`);
    return { status: 'ok', message: 'Payroll paid and posted.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function remitRunAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = text(formData, 'id');
    await apiFetch(`/api/payroll/runs/${id}/remit`, {
      method: 'POST',
      body: {
        kind: text(formData, 'kind'),
        evidenceDocumentId: text(formData, 'evidenceDocumentId'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
    revalidatePayroll();
    revalidatePath(`/hr/payroll/${id}`);
    return { status: 'ok', message: 'Statutory amount marked remitted.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function adjustRunAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const created = await apiFetch<PayrollRunView>(`/api/payroll/runs/${text(formData, 'id')}/adjust`, {
      method: 'POST',
      body: {
        reason: text(formData, 'reason'),
        rowVersion: Number(text(formData, 'rowVersion')),
        idempotencyKey: text(formData, 'idempotencyKey'),
      },
    });
    revalidatePayroll();
    redirect(`/hr/payroll/${created.id}`);
  } catch (error) {
    return toActionResult(error);
  }
}

export async function updateSettingsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/payroll/settings', {
      method: 'PATCH',
      body: {
        edFinanceThresholdKobo: Number(text(formData, 'edFinanceThresholdKobo')),
        overtimeMultiplierBps: Number(text(formData, 'overtimeMultiplierBps')),
        includeSuspended: text(formData, 'includeSuspended') === 'true',
        unpaidLeaveDailyDivisor: Number(text(formData, 'unpaidLeaveDailyDivisor')),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
    revalidatePayroll();
    return { status: 'ok', message: 'Payroll settings saved.' };
  } catch (error) {
    return toActionResult(error);
  }
}
