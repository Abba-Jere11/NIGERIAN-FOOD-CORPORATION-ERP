'use server';

import { apiFetch } from '@/lib/api';

export async function revokeSessionAction(id: string): Promise<void> {
  await apiFetch(`/api/auth/sessions/${id}/revoke`, { method: 'POST' });
}
