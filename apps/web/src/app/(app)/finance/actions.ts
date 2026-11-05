'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseNairaToKobo } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { ApiError, apiFetch, apiFetchForm } from '@/lib/api';

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

function nairaToKobo(value: string): number {
  return Number(parseNairaToKobo(value));
}

export async function createAccountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/accounts', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        code: text(formData, 'code'),
        name: text(formData, 'name'),
        type: text(formData, 'type'),
        parentId: text(formData, 'parentId') || null,
        normalBalance: text(formData, 'normalBalance'),
        consolidationCode: text(formData, 'consolidationCode') || text(formData, 'code'),
        intercompany: formData.get('intercompany') === 'on',
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/coa');
  return { status: 'ok', message: 'Account saved.' };
}

export async function deactivateAccountAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/finance/accounts/${text(formData, 'id')}/deactivate`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/coa');
  return { status: 'ok', message: 'Account deactivated.' };
}

export async function closePeriodAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/finance/periods/${text(formData, 'id')}/close`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/periods');
  return { status: 'ok', message: 'Period closed.' };
}

function journalLines(formData: FormData) {
  const accountIds = formData.getAll('accountId').map((value) => String(value));
  const sides = formData.getAll('side').map((value) => String(value));
  const amounts = formData.getAll('amount').map((value) => String(value));
  return accountIds.map((accountId, index) => {
    const amount = nairaToKobo(amounts[index] ?? '0');
    const debit = sides[index] === 'CREDIT' ? 0 : amount;
    return {
      accountId,
      debitKobo: debit,
      creditKobo: debit === 0 ? amount : 0,
    };
  });
}

export async function createJournalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let id = '';
  try {
    const created = await apiFetch<{ id: string }>('/api/finance/journals', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        fiscalPeriodId: text(formData, 'fiscalPeriodId'),
        narration: text(formData, 'narration'),
        idempotencyKey: text(formData, 'idempotencyKey') || randomUUID(),
        lines: journalLines(formData),
      },
    });
    id = created.id;
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/journals');
  redirect(`/finance/journals/${id}`);
}

export async function submitJournalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/finance/journals/${id}/submit`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/finance/journals/${id}`);
  revalidatePath('/finance/journals');
  return { status: 'ok', message: 'Journal submitted.' };
}

export async function reverseJournalAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/finance/journals/${id}/reverse`, {
      method: 'POST',
      body: {
        reason: text(formData, 'reason'),
        fiscalPeriodId: text(formData, 'fiscalPeriodId'),
        idempotencyKey: randomUUID(),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/journals');
  return { status: 'ok', message: 'Reversal journal submitted.' };
}

export async function createBudgetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let id = '';
  try {
    const codes = formData.getAll('lineCode').map((value) => String(value));
    const names = formData.getAll('lineName').map((value) => String(value));
    const amounts = formData.getAll('lineAmount').map((value) => String(value));
    const created = await apiFetch<{ id: string }>('/api/finance/budgets', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        fiscalYearId: text(formData, 'fiscalYearId'),
        lines: codes.map((code, index) => ({
          code,
          name: names[index] ?? code,
          approvedAmountKobo: nairaToKobo(amounts[index] ?? '0'),
        })),
      },
    });
    id = created.id;
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/budgets');
  redirect(`/finance/budgets/${id}`);
}

export async function submitBudgetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch(`/api/finance/budgets/${id}/submit`, {
      method: 'POST',
      body: { rowVersion: Number(text(formData, 'rowVersion')) },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath(`/finance/budgets/${id}`);
  return { status: 'ok', message: 'Budget submitted.' };
}

export async function transferAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/bank-transfers', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        sourceAccountId: text(formData, 'sourceAccountId'),
        destinationAccountId: text(formData, 'destinationAccountId'),
        amountKobo: nairaToKobo(text(formData, 'amount')),
        occurredOn: text(formData, 'occurredOn'),
        narration: text(formData, 'narration'),
        fiscalPeriodId: text(formData, 'fiscalPeriodId'),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/bank');
  return { status: 'ok', message: 'Transfer recorded.' };
}

export async function importStatementAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const accountId = text(formData, 'accountId');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'A statement file is required.' };
  }
  const payload = new FormData();
  payload.set('file', file);
  payload.set(
    'mapping',
    JSON.stringify({
      dateColumn: text(formData, 'dateColumn') || 'date',
      descriptionColumn: text(formData, 'descriptionColumn') || 'description',
      amountColumn: text(formData, 'amountColumn') || 'amount',
    }),
  );
  try {
    await apiFetchForm(`/api/finance/bank-accounts/${accountId}/statements`, payload);
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/bank');
  return { status: 'ok', message: 'Statement imported.' };
}

export async function reconcileAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/reconcile', {
      method: 'POST',
      body: {
        statementLineId: text(formData, 'statementLineId'),
        bankTransactionId: text(formData, 'bankTransactionId') || null,
        journalLineId: text(formData, 'journalLineId') || null,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/bank');
  return { status: 'ok', message: 'Line matched.' };
}

export async function unmatchAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch(`/api/finance/reconcile/${text(formData, 'lineId')}/unmatch`, {
      method: 'POST',
      body: { reason: text(formData, 'reason') },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/bank');
  return { status: 'ok', message: 'Line unmatched.' };
}

export async function createCustomerAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/customers', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        name: text(formData, 'name'),
        termsDays: Number(text(formData, 'termsDays') || '30'),
        creditLimitKobo: nairaToKobo(text(formData, 'creditLimit')),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/customers');
  redirect('/finance/customers');
}

export async function createIncomeAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/income', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        categoryKey: text(formData, 'categoryKey'),
        settlement: text(formData, 'settlement'),
        customerId: text(formData, 'customerId') || undefined,
        bankAccountId: text(formData, 'bankAccountId') || undefined,
        amountKobo: nairaToKobo(text(formData, 'amount')),
        occurredOn: text(formData, 'occurredOn'),
        dueDate: text(formData, 'dueDate') || undefined,
        narration: text(formData, 'narration'),
        idempotencyKey: randomUUID(),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/income');
  redirect('/finance/income');
}

export async function submitIncomeAction(formData: FormData): Promise<void> {
  await apiFetch(`/api/finance/income/${text(formData, 'id')}/submit`, {
    method: 'POST',
    body: { rowVersion: Number(text(formData, 'rowVersion')) },
  });
  revalidatePath('/finance/income');
}

export async function createExpenseAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/expenses', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        categoryKey: text(formData, 'categoryKey'),
        settlement: text(formData, 'settlement'),
        vendorId: text(formData, 'vendorId') || undefined,
        bankAccountId: text(formData, 'bankAccountId') || undefined,
        amountKobo: nairaToKobo(text(formData, 'amount')),
        occurredOn: text(formData, 'occurredOn'),
        dueDate: text(formData, 'dueDate') || undefined,
        narration: text(formData, 'narration'),
        idempotencyKey: randomUUID(),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/expenses');
  redirect('/finance/expenses');
}

export async function submitExpenseAction(formData: FormData): Promise<void> {
  await apiFetch(`/api/finance/expenses/${text(formData, 'id')}/submit`, {
    method: 'POST',
    body: { rowVersion: Number(text(formData, 'rowVersion')) },
  });
  revalidatePath('/finance/expenses');
}

export async function createBillAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/payables', {
      method: 'POST',
      body: {
        entityId: text(formData, 'entityId'),
        vendorId: text(formData, 'vendorId'),
        invoiceDate: text(formData, 'invoiceDate'),
        dueDate: text(formData, 'dueDate'),
        amountKobo: nairaToKobo(text(formData, 'amount')),
        narration: text(formData, 'narration'),
        idempotencyKey: randomUUID(),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/payables');
  redirect('/finance/payables');
}

export async function submitBillAction(formData: FormData): Promise<void> {
  await apiFetch(`/api/finance/payables/${text(formData, 'id')}/submit`, {
    method: 'POST',
    body: { rowVersion: Number(text(formData, 'rowVersion')) },
  });
  revalidatePath('/finance/payables');
}

export async function createIntercompanyAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await apiFetch('/api/finance/intercompany', {
      method: 'POST',
      body: {
        type: text(formData, 'type'),
        sourceEntityId: text(formData, 'sourceEntityId'),
        destinationEntityId: text(formData, 'destinationEntityId'),
        sourceBankAccountId: text(formData, 'sourceBankAccountId'),
        destBankAccountId: text(formData, 'destBankAccountId'),
        amountKobo: nairaToKobo(text(formData, 'amount')),
        occurredOn: text(formData, 'occurredOn'),
        narration: text(formData, 'narration'),
        idempotencyKey: randomUUID(),
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/finance/intercompany');
  redirect('/finance/intercompany');
}

export async function acknowledgeIntercompanyAction(formData: FormData): Promise<void> {
  await apiFetch(`/api/finance/intercompany/${text(formData, 'id')}/acknowledge`, {
    method: 'POST',
    body: { rowVersion: Number(text(formData, 'rowVersion')) },
  });
  revalidatePath('/finance/intercompany');
}
