import type { NotificationPreferenceView, NotificationView } from '@nfc/shared';
import Link from 'next/link';
import { formatLagosDateTime } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { MarkReadButton } from './MarkReadButton';
import { PreferenceForm } from './PreferenceForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications — NFC' };

export default async function NotificationsPage() {
  const [rows, preferences] = await Promise.all([
    apiFetch<NotificationView[]>('/api/notifications'),
    apiFetch<NotificationPreferenceView[]>('/api/notifications/preferences'),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Action-required notices cannot be switched off in your email preferences."
      />
      {rows.length === 0 ? (
        <Surface>
          <EmptyState title="No notices" description="When something needs your attention, it will appear here." />
        </Surface>
      ) : (
        <Surface padded={false}>
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className={`border-b border-ink-100 px-4 py-3 last:border-b-0 ${row.readAt ? '' : 'bg-accent-50'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink-900">{row.title}</p>
                    <p className="mt-1 text-[13px] text-ink-700">{row.body}</p>
                    <p className="mt-1 text-[12px] text-ink-500">{formatLagosDateTime(row.createdAt)}</p>
                    {row.href ? (
                      <Link href={row.href} className="mt-1 inline-block text-[12px] text-accent-800 underline">
                        Open record
                      </Link>
                    ) : null}
                  </div>
                  <MarkReadButton id={row.id} read={Boolean(row.readAt)} />
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      )}
      <Surface padded={false} className="mt-4">
        <SurfaceHeader
          title="Email preferences"
          description="Action-required categories stay on. In-app notices are always delivered."
        />
        <PreferenceForm preferences={preferences} />
      </Surface>
    </>
  );
}
