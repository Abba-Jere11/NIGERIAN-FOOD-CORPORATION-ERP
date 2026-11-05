import type { AdminOpsView, ReferenceCounterView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminHealthPage() {
  const [ops, counters] = await Promise.all([
    apiFetch<AdminOpsView>('/api/admin/ops'),
    apiFetch<ReferenceCounterView[]>('/api/admin/reference-counters'),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Health"
        description="Dead-letter events, failed deliveries, and reference counters. Redis is not used; jobs poll PostgreSQL."
      />
      <div className="space-y-4">
        <Surface>
          <p className="text-[13px] text-ink-800">Failed notification deliveries: {ops.failedNotificationDeliveries}</p>
          <p className="mt-1 text-[13px] text-ink-800">Failed email deliveries: {ops.failedMail}</p>
          <p className="mt-1 text-[13px] text-ink-600">Your unread notices: {ops.unreadNotifications}</p>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="Dead-letter events" description="Handlers that exhausted retries." />
          {ops.deadLetters.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-600">None.</p>
          ) : (
            <ul className="divide-y divide-ink-100 text-[13px]">
              {ops.deadLetters.map((row) => (
                <li key={row.deliveryId} className="px-4 py-2">
                  <span className="font-medium">{row.eventType}</span> → {row.handlerKey}
                  <span className="block text-[12px] text-ink-500">
                    {row.attempts} attempts. {row.lastError}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="Reference counters" description="Read-only. Numbers are never reused after commit." />
          {counters.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-600">No numbers have been allocated yet.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 text-[12px] text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium">Year</th>
                  <th className="px-4 py-2 font-medium">Last value</th>
                </tr>
              </thead>
              <tbody>
                {counters.map((row) => (
                  <tr key={`${row.kind}-${row.year}`} className="border-b border-ink-100">
                    <td className="px-4 py-2">{row.kind}</td>
                    <td className="px-4 py-2 tabular">{row.year === 0 ? '—' : row.year}</td>
                    <td className="px-4 py-2 tabular">{row.lastValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      </div>
    </>
  );
}
