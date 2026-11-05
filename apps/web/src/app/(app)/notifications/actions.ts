'use server';

import { revalidatePath } from 'next/cache';
import type { NotificationView } from '@nfc/shared';
import { apiFetch } from '@/lib/api';

export async function markNotificationRead(id: string, read: boolean): Promise<void> {
  await apiFetch(`/api/notifications/${id}/${read ? 'read' : 'unread'}`, { method: 'POST' });
  revalidatePath('/notifications');
}

export async function setNotificationPreference(
  category: string,
  emailEnabled: boolean,
): Promise<void> {
  await apiFetch('/api/notifications/preferences', {
    method: 'PATCH',
    body: { category, emailEnabled },
  });
  revalidatePath('/notifications');
}

/** Recent notifications and the unread count for the header quick view. */
export async function loadRecentNotifications(): Promise<{ items: NotificationView[]; unread: number }> {
  const [items, unread] = await Promise.all([
    apiFetch<NotificationView[]>('/api/notifications', { query: { limit: 10 } }),
    apiFetch<{ count: number }>('/api/notifications/unread-count'),
  ]);
  return { items, unread: unread.count };
}

export async function unreadNotificationCount(): Promise<number> {
  const result = await apiFetch<{ count: number }>('/api/notifications/unread-count').catch(() => ({ count: 0 }));
  return result.count;
}

/** Marks one notification read from the quick view without a page refresh. */
export async function readNotificationQuietly(id: string): Promise<void> {
  await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch('/api/notifications/read-all', { method: 'POST' });
  revalidatePath('/notifications');
}
