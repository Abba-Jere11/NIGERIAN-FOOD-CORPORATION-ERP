import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('admin.user.manage')) redirect('/forbidden');
  const [types, sla] = await Promise.all([
    apiFetch<Array<{ type: string; label: string; category: string; mandatory: boolean }>>(
      '/api/admin/notification-types',
    ),
    apiFetch<Array<{ days: number }>>('/api/admin/sla-thresholds'),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Notifications and SLA"
        description="Read-only configuration surfaced for operators."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="Notification types" description={`${types.length} registered handlers`} />
          <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
            {types.map((row) => (
              <li key={row.type} className="py-2">
                <span className="font-medium">{row.label}</span>
                <span className="text-ink-500">
                  {' '}
                  · {row.type} · {row.category}
                  {row.mandatory ? ' · mandatory' : ''}
                </span>
              </li>
            ))}
          </ul>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="SLA thresholds" description="Escalation day counts (configuration table)." />
          <ul className="px-4 py-3 text-[13px]">
            {sla.map((row) => (
              <li key={row.days} className="py-1">
                {row.days} day{row.days === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </Surface>
      </div>
    </>
  );
}
