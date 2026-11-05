import type { CaseListItemView, MeView } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cases — NFC' };

export default async function CasesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('cases.view') && !me.permissions.includes('cases.create')) {
    redirect('/forbidden');
  }
  const rows = await apiFetch<CaseListItemView[]>('/api/cases');
  const canCreate = me.permissions.includes('cases.create');

  return (
    <>
      <PageHeader
        eyebrow="Confidential"
        title="Cases"
        description="Visible only to people on the case. Assigning a handler is not the same as granting extra access."
        actions={
          canCreate ? (
            <ButtonLink href="/cases/new" variant="primary">
              New case
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title="Register" description="Cases you created, were assigned, or were granted." />
        {rows.length === 0 ? (
          <EmptyState title="No cases yet" description="Open a case, or wait until one is assigned or granted to you." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Assigned</th>
                <th className="px-4 py-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/cases/${row.id}`} className="text-accent-800 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.title}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">{row.assignedUserName ?? '—'}</td>
                  <td className="px-4 py-2 tabular text-ink-500">{formatLagosDateTime(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
