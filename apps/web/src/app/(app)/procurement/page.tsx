import type { MeView, ProcurementListView } from '@nfc/shared';
import {
  PROCUREMENT_M9_TILE_STATUSES,
  PROCUREMENT_STATUSES,
  PROCUREMENT_TILE_LABELS,
  formatKobo,
  formatLagosDateTime,
  hasProcurementNavPermission,
} from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { CONTROL_CLASS } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Procurement — NFC' };

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasProcurementNavPermission(me.permissions)) redirect('/forbidden');
  const query = await searchParams;
  const list = await apiFetch<ProcurementListView>('/api/procurement', {
    query: { status: query.status, q: query.q },
  });
  const canCreate = me.permissions.includes('requisition.create');

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="My Procurement"
        description="Structured requests. The memo is generated from the fields; there is no free-text memo."
        actions={
          canCreate ? (
            <ButtonLink href="/requisitions/new" variant="primary">
              New requisition
            </ButtonLink>
          ) : null
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {PROCUREMENT_M9_TILE_STATUSES.map((status) => (
          <Link
            key={status}
            href={`/procurement?status=${status}`}
            className="border border-ink-200 bg-surface px-3 py-2"
          >
            <p className="text-[11px] uppercase tracking-wider text-ink-500">{PROCUREMENT_TILE_LABELS[status]}</p>
            <p className="tabular text-[20px] font-semibold text-ink-900">{list.counts[status] ?? 0}</p>
          </Link>
        ))}
      </div>
      <Surface className="mb-4">
        <form method="get" className="grid gap-3 px-4 py-3 sm:grid-cols-3">
          <label className="text-[12px] font-semibold text-ink-700">
            Status
            <select name="status" defaultValue={query.status ?? ''} className={`mt-1 ${CONTROL_CLASS}`}>
              <option value="">All</option>
              {PROCUREMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PROCUREMENT_TILE_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-700 sm:col-span-2">
            Search
            <input name="q" defaultValue={query.q ?? ''} className={`mt-1 ${CONTROL_CLASS}`} />
          </label>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Requests" description={`${list.items.length} visible in this filter.`} />
        {list.items.length === 0 ? (
          <EmptyState title="No requests" description="Create a draft to start a procurement request." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Title</th>
                <th className="px-4 py-2 font-semibold">Vendor</th>
                <th className="px-4 py-2 font-semibold">Amount</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {list.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <Link href={`/procurement/${row.id}`} className="font-medium text-accent-700 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.title}</td>
                  <td className="px-4 py-2">{row.vendorName ?? '—'}</td>
                  <td className="px-4 py-2 tabular">
                    {row.totalAmountKobo === null ? '—' : formatKobo(BigInt(row.totalAmountKobo))}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-ink-600">{formatLagosDateTime(row.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
