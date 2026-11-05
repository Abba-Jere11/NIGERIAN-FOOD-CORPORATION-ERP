import type { FinanceContextView, MeView, PayableInvoiceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payables — NFC' };

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<FinanceContextView>('/api/finance/context'),
  ]);
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const rows = await apiFetch<PayableInvoiceView[]>('/api/finance/payables', {
    query: { entityId: resolved.entityId },
  });
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Payables"
        description="Vendor bills and procurement invoices. Overdue is computed from the due date."
        actions={
          me.permissions.includes('finance.payables.manage') && resolved.entityId ? (
            <ButtonLink href={withScope('/finance/payables/new', scope)} variant="primary">
              New bill
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No payables" description="Approved bills appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">Outstanding</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={withScope(`/finance/payables/${row.id}`, scope)} className="underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.vendorName ?? '—'}</td>
                  <td className="px-4 py-2">{row.dueDate}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.outstandingKobo))}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.overdue ? 'OVERDUE' : row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
