'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { EdmsDocumentView } from '@nfc/shared';
import { ApiError, apiFetch, apiFetchForm } from '@/lib/api';

function revalidateDocument(documentId: string): void {
  revalidatePath(`/edms/documents/${documentId}`);
}

export async function uploadEdmsAction(formData: FormData): Promise<{ error?: string }> {
  try {
    const tags = formData.getAll('tags').map(String).filter(Boolean);
    formData.delete('tags');
    formData.set('tags', tags.join(','));
    const created = await apiFetchForm<EdmsDocumentView>('/api/edms/upload', formData);
    revalidatePath('/edms');
    if (created.folderId && created.entityCode) {
      redirect(`/edms/${created.entityCode}/folders/${created.folderId}`);
    }
    redirect(`/edms/documents/${created.id}`);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function replaceEdmsAction(
  documentId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    await apiFetchForm(`/api/edms/documents/${documentId}/versions`, formData);
    revalidateDocument(documentId);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function archiveEdmsAction(documentId: string, formData: FormData): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/edms/documents/${documentId}/archive`, {
      method: 'POST',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    revalidateDocument(documentId);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function shareEdmsAction(documentId: string, formData: FormData): Promise<{ error?: string }> {
  try {
    const userId = String(formData.get('granteeUserId') ?? '').trim();
    const role = String(formData.get('granteeRole') ?? '').trim();
    const expiresAt = String(formData.get('expiresAt') ?? '').trim();
    await apiFetch(`/api/edms/documents/${documentId}/share`, {
      method: 'POST',
      body: {
        ...(userId ? { granteeUserId: userId } : {}),
        ...(role ? { granteeRole: role } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      },
    });
    revalidateDocument(documentId);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function revokeShareAction(documentId: string, shareId: string): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/edms/documents/${documentId}/share/${shareId}/revoke`, { method: 'POST', body: {} });
    revalidateDocument(documentId);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function holdEdmsAction(documentId: string, formData: FormData): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/edms/documents/${documentId}/legal-hold`, {
      method: 'POST',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    revalidateDocument(documentId);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function refileEdmsAction(documentId: string, formData: FormData): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/edms/documents/${documentId}/refile`, {
      method: 'POST',
      body: {
        destEntityId: String(formData.get('destEntityId') ?? ''),
        destFolderId: String(formData.get('destFolderId') ?? '') || undefined,
        reason: String(formData.get('reason') ?? ''),
      },
    });
    revalidateDocument(documentId);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function saveCategoryAction(formData: FormData): Promise<{ error?: string }> {
  try {
    await apiFetch('/api/edms/categories', {
      method: 'POST',
      body: {
        id: String(formData.get('id') ?? '') || undefined,
        key: String(formData.get('key') ?? ''),
        name: String(formData.get('name') ?? ''),
        module: String(formData.get('module') ?? ''),
        retainYears: Number(formData.get('retainYears') ?? 7),
        requiresApproval: formData.get('requiresApproval') === 'on',
        confidentiality: String(formData.get('confidentiality') ?? 'INTERNAL'),
      },
    });
    revalidatePath('/edms/admin');
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function saveTagAction(formData: FormData): Promise<{ error?: string }> {
  try {
    await apiFetch('/api/edms/tags', {
      method: 'POST',
      body: {
        id: String(formData.get('id') ?? '') || undefined,
        key: String(formData.get('key') ?? ''),
        name: String(formData.get('name') ?? ''),
      },
    });
    revalidatePath('/edms/admin');
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export async function releaseHoldAction(
  documentId: string,
  holdId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/edms/documents/${documentId}/legal-hold/${holdId}/release`, {
      method: 'POST',
      body: { reason: String(formData.get('reason') ?? '') },
    });
    revalidatePath('/edms/admin');
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}
