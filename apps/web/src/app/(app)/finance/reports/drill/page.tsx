import type { FinanceContextView, LedgerDrillEntryView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ledger drill — NFC' };

export default async function ReportDrillPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; accountCodes?: string; periodId?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const entries = query.accountCodes
    ? await apiFetch<LedgerDrillEntryView[]>('/api/finance/reports/drill', {
        query: {
          entityId: resolved.entityId,
          consolidated: resolved.consolidated ? 'true' : undefined,
          accountCodes: query.accountCodes,
          periodId: query.periodId,
        },
      })
    : [];

  return (
    <>
      <PageHeader eyebrow="Finance" title="Ledger lines" description={query.accountCodes ?? 'Select a figure to drill.'} />
      <Surface padded={false}>
        <SurfaceHeader title="Posted lines" />
        {entries.length === 0 ? (
          <EmptyState title="No lines" description="Nothing posted for those accounts in this window." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Journal</th>
                <th className="px-4 py-2 font-semibold">Account</th>
                <th className="px-4 py-2 font-semibold">Narration</th>
                <th className="px-4 py-2 font-semibold">Source</th>
                <th className="px-4 py-2 font-semibold">Debit</th>
                <th className="px-4 py-2 font-semibold">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.journalLineId} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={withScope(`/finance/journals/${entry.journalId}`, scope)} className="underline">
                      {entry.journalReference}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {entry.accountCode} {entry.accountName}
                  </td>
                  <td className="px-4 py-2">{entry.narration}</td>
                  <td className="px-4 py-2">
                    {entry.sourceHref ? (
                      <Link href={entry.sourceHref} className="underline">
                        {entry.sourceLabel}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="tabular px-4 py-2">
                    {entry.debitKobo ? formatKobo(BigInt(entry.debitKobo)) : '—'}
                  </td>
                  <td className="tabular px-4 py-2">
                    {entry.creditKobo ? formatKobo(BigInt(entry.creditKobo)) : '—'}
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
