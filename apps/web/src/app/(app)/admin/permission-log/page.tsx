import type { PermissionChangeView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function PermissionLogPage() {
  const rows = await apiFetch<PermissionChangeView[]>('/api/admin/permission-changes');

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Permission log"
        description="Account and grant changes. This is not the business audit log."
      />
      <Surface padded={false}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Subject</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-ink-100">
                <td className="px-3 py-2 tabular text-[12px]">{formatLagosDateTime(row.occurredAt)}</td>
                <td className="px-3 py-2">{row.actorName ?? '—'}</td>
                <td className="px-3 py-2">{row.action}</td>
                <td className="px-3 py-2">{row.subjectLabel ?? row.subjectType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </>
  );
}
