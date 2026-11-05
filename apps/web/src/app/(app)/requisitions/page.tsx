import type { MeView, RequisitionView } from '@nfc/shared';
import { formatLagosDateTime, hasRequisitionNavPermission } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Requisitions — NFC' };

export default async function RequisitionsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasRequisitionNavPermission(me.permissions)) redirect('/forbidden');
  const list = await apiFetch<{ items: RequisitionView[] }>('/api/requisitions');
  const canCreate = me.permissions.includes('requisition.create');

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Requisitions"
        description="Need only. Prices, vendors and invoices are added after MD need-approval."
        actions={
          canCreate ? (
            <ButtonLink href="/requisitions/new" variant="primary">
              New requisition
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title="Need requests" description={`${list.items.length} visible.`} />
        {list.items.length === 0 ? (
          <EmptyState title="No requisitions" description="Create a draft to start a need request." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Proposal</th>
                <th className="px-4 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {list.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <Link href={`/requisitions/${row.id}`} className="font-medium text-accent-700 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.title}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">
                    {row.procurementRequestId ? (
                      <Link href={`/procurement/${row.procurementRequestId}`} className="underline">
                        {row.procurementReference ?? 'Proposal'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-600">{formatLagosDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
