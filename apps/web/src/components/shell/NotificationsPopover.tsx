'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { NotificationView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import {
  loadRecentNotifications,
  markAllNotificationsRead,
  readNotificationQuietly,
  unreadNotificationCount,
} from '@/app/(app)/notifications/actions';
import { cx } from '@/lib/cx';

const POLL_MS = 60_000;

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatLagosDateTime(iso);
}

/**
 * The header bell. Opens recent notifications in place; the full history stays
 * on the notifications page.
 */
export function NotificationsPopover({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await loadRecentNotifications();
        setItems(result.items);
        setUnread(result.unread);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      unreadNotificationCount()
        .then(setUnread)
        .catch(() => undefined);
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) refresh();
  };

  const openItem = (item: NotificationView) => {
    setOpen(false);
    if (!item.readAt) {
      setUnread((count) => Math.max(count - 1, 0));
      setItems((list) => list?.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)) ?? null);
    }
    startTransition(async () => {
      if (!item.readAt) await readNotificationQuietly(item.id).catch(() => undefined);
      if (item.href) router.push(item.href);
      router.refresh();
    });
  };

  const markAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead().catch(() => undefined);
      setUnread(0);
      setItems((list) => list?.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })) ?? null);
      router.refresh();
    });
  };

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div ref={rootRef} className="no-print relative hidden sm:block">
      <button
        ref={buttonRef}
        type="button"
        title="Notifications"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="relative flex h-8 min-w-8 items-center justify-center border border-white/20 px-1.5 text-white"
      >
        <span aria-hidden="true">&#9737;</span>
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-sm bg-white px-0.5 text-center text-[10px] font-semibold text-accent-800">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Recent notifications"
          data-testid="notifications-popover"
          className="absolute right-0 z-40 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] border border-ink-200 bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
            <p className="text-[13px] font-semibold text-ink-900">
              Notifications{unread > 0 ? ` · ${unread} unread` : ''}
            </p>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="text-[12px] text-accent-800 underline">
                Mark all as read
              </button>
            ) : null}
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {items === null ? (
              <p className="px-3 py-4 text-[13px] text-ink-600">{failed ? 'Notifications could not be loaded.' : 'Loading…'}</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-ink-600">You have no notifications yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cx(
                        'flex w-full gap-2 px-3 py-2 text-left hover:bg-ink-100',
                        !item.readAt && 'bg-accent-50',
                      )}
                      data-testid="notification-item"
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          item.readAt ? 'bg-transparent' : 'bg-accent-700',
                        )}
                      />
                      <span className="min-w-0">
                        <span className={cx('block text-[13px] text-ink-900', !item.readAt && 'font-semibold')}>
                          {item.title}
                          {!item.readAt ? <span className="sr-only"> (unread)</span> : null}
                        </span>
                        {item.body ? <span className="line-clamp-3 block text-[12px] text-ink-700">{item.body}</span> : null}
                        <span className="block text-[11px] text-ink-500">
                          {relativeTime(item.createdAt)}
                          {item.href ? ' · Open record' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-ink-200 px-3 py-2 text-[12px]">
            <Link href="/notifications" onClick={() => setOpen(false)} className="font-medium underline">
              View all notifications
            </Link>
            {pending ? <span className="text-ink-500">Updating…</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
