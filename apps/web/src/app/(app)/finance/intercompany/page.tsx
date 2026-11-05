import type { FinanceContextView, IntercompanyTransactionView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inter-company — NFC' };

export default async function IntercompanyPage({
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
  const [rows, mismatches] = await Promise.all([
    apiFetch<IntercompanyTransactionView[]>('/api/finance/intercompany'),
    apiFetch<IntercompanyTransactionView[]>('/api/finance/intercompany/mismatches'),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Inter-company"
        description="One linked transaction referenced by both entities. Mismatches appear when only one side is posted."
        actions={
          me.permissions.includes('finance.intercompany.create') ? (
            <ButtonLink href={withScope('/finance/intercompany/new', scope)} variant="primary">
              New transfer
            </ButtonLink>
          ) : null
        }
      />
      {mismatches.length > 0 ? (
        <p className="mb-3 border border-danger-300 bg-surface px-3 py-2 text-[13px] text-danger-800">
          {mismatches.length} mismatched inter-company balance{mismatches.length === 1 ? '' : 's'}.
        </p>
      ) : null}
      <Surface padded={false}>
        <SurfaceHeader title="Linked transactions" />
        {rows.length === 0 ? (
          <EmptyState title="No inter-company transactions" description="Record a funding, loan, recharge or transfer." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">To</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={withScope(`/finance/intercompany/${row.id}`, scope)} className="underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.sourceEntityCode}</td>
                  <td className="px-4 py-2">{row.destinationEntityCode}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.amountKobo))}</td>
                  <td className="px-4 py-2">
                    {row.mismatched ? 'Mismatch' : row.acknowledgedAt ? 'Acknowledged' : 'Recorded'}
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
