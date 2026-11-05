import type { AccountView, FinanceContextView, LedgerEntryView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { CONTROL_CLASS } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ledger — NFC' };

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; accountId?: string; periodId?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const accounts = await apiFetch<AccountView[]>('/api/finance/accounts', {
    query: { entityId: resolved.entityId },
  });
  const accountId = query.accountId ?? accounts.find((account) => account.code === '1120')?.id ?? accounts[0]?.id;
  const entries = accountId
    ? await apiFetch<LedgerEntryView[]>('/api/finance/ledger', {
        query: { accountId, periodId: query.periodId },
      })
    : [];
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Account ledger"
        description="Posted journals only. Open a journal reference to see the entry and any source document."
      />
      <Surface className="mb-4">
        <form method="get" className="px-4 py-3">
          {scope ? <input type="hidden" name="scope" value={scope} /> : null}
          {query.periodId ? <input type="hidden" name="periodId" value={query.periodId} /> : null}
          <label className="text-[12px] font-semibold text-ink-700">
            Account
            <select name="accountId" defaultValue={accountId ?? ''} className={`mt-1 ${CONTROL_CLASS}`}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
          </label>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader
          title="Postings"
          description="Amounts come from posted journal lines. Follow the journal link for sourceHref drill-through."
        />
        {entries.length === 0 ? (
          <EmptyState title="No postings" description="Posted lines for this account will appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Journal</th>
                <th className="px-4 py-2 font-semibold">Narration</th>
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
                  <td className="px-4 py-2">{entry.narration}</td>
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
