'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { VendorView } from '@nfc/shared';
import type { ActionResult } from '@/lib/action-result';
import { apiFetch, apiFetchForm, ApiError } from '@/lib/api';

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = text(formData, key);
  return value === '' ? undefined : value;
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

function contactsFrom(formData: FormData) {
  const name = optionalText(formData, 'contactName');
  if (!name) return [];
  return [
    {
      name,
      phone: optionalText(formData, 'contactPhone') ?? null,
      email: optionalText(formData, 'contactEmail') ?? null,
      role: optionalText(formData, 'contactRole') ?? null,
    },
  ];
}

export async function createVendorAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let vendor: VendorView;
  try {
    vendor = await apiFetch<VendorView>('/api/vendors', {
      method: 'POST',
      body: {
        legalName: text(formData, 'legalName'),
        cacRegistrationNumber: text(formData, 'cacRegistrationNumber'),
        categoryId: text(formData, 'categoryId'),
        notes: optionalText(formData, 'notes') ?? null,
        contacts: contactsFrom(formData),
        bankName: optionalText(formData, 'bankName') ?? null,
        accountName: optionalText(formData, 'accountName') ?? null,
        accountNumber: optionalText(formData, 'accountNumber') ?? null,
      },
    });
  } catch (error) {
    return toActionResult(error);
  }
  revalidatePath('/vendors');
  redirect(`/vendors/${vendor.id}`);
}

export async function updateVendorAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<VendorView>(`/api/vendors/${id}`, {
      method: 'PATCH',
      body: {
        legalName: text(formData, 'legalName'),
        cacRegistrationNumber: text(formData, 'cacRegistrationNumber'),
        categoryId: text(formData, 'categoryId'),
        notes: optionalText(formData, 'notes') ?? null,
        contacts: contactsFrom(formData),
        bankName: optionalText(formData, 'bankName') ?? null,
        accountName: optionalText(formData, 'accountName') ?? null,
        accountNumber: optionalText(formData, 'accountNumber') ?? null,
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
    revalidatePath('/vendors');
    revalidatePath(`/vendors/${id}`);
    return { status: 'ok', message: 'Changes saved.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function submitVendorAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<VendorView>(`/api/vendors/${id}/submit`, { method: 'POST', body: {} });
    revalidatePath('/vendors');
    revalidatePath(`/vendors/${id}`);
    revalidatePath('/workflows');
    return { status: 'ok', message: 'Submitted for onboarding review.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function vendorStatusAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  const action = text(formData, 'action');
  const path =
    action === 'suspend'
      ? 'suspend'
      : action === 'blacklist'
        ? 'blacklist'
        : action === 'reactivate'
          ? 'reactivate'
          : action === 'approve-bank'
            ? 'bank-details/approve'
            : null;
  if (!path) return { status: 'error', message: 'Unknown action.' };
  try {
    const body =
      action === 'approve-bank'
        ? { rowVersion: Number(text(formData, 'rowVersion')) }
        : {
            reason: optionalText(formData, 'reason'),
            rowVersion: Number(text(formData, 'rowVersion')),
          };
    await apiFetch<VendorView>(`/api/vendors/${id}/${path}`, {
      method: 'POST',
      body,
    });
    revalidatePath('/vendors');
    revalidatePath(`/vendors/${id}`);
    return { status: 'ok', message: 'Recorded.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function changeBankAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, 'id');
  try {
    await apiFetch<VendorView>(`/api/vendors/${id}/bank-details`, {
      method: 'POST',
      body: {
        bankName: text(formData, 'bankName'),
        accountName: text(formData, 'accountName'),
        accountNumber: text(formData, 'accountNumber'),
        rowVersion: Number(text(formData, 'rowVersion')),
      },
    });
    revalidatePath(`/vendors/${id}`);
    return { status: 'ok', message: 'Bank details submitted for re-verification.' };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function uploadComplianceAction(formData: FormData): Promise<{ error?: string }> {
  const vendorId = text(formData, 'vendorId');
  try {
    await apiFetchForm<VendorView>(`/api/vendors/${vendorId}/compliance-documents`, formData);
    revalidatePath(`/vendors/${vendorId}`);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}
