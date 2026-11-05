'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiFetchForm, ApiError } from '@/lib/api';
import type { DocumentView } from '@nfc/shared';

export async function uploadDocumentAction(formData: FormData): Promise<{ error?: string }> {
  let created: DocumentView;
  try {
    created = await apiFetchForm<DocumentView>('/api/documents', formData);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  revalidatePath('/documents');
  redirect(`/documents/${created.id}`);
}

export async function replaceDocumentAction(documentId: string, formData: FormData): Promise<{ error?: string }> {
  try {
    await apiFetchForm<DocumentView>(`/api/documents/${documentId}/versions`, formData);
    revalidatePath(`/documents/${documentId}`);
    return {};
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}
