import type { FinanceContextView, FiscalYearView, TrialBalanceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { CONTROL_CLASS } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trial balance — NFC' };

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; periodId?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const years = await apiFetch<FiscalYearView[]>('/api/finance/years', {
    query: { entityId: resolved.entityId },
  });
  const yearForPeriods = years.find((year) => year.entityCode === resolved.entityCode) ?? years[0];
  const trial = await apiFetch<TrialBalanceView>('/api/finance/trial-balance', {
    query: {
      entityId: resolved.entityId,
      consolidated: resolved.consolidated ? 'true' : undefined,
      periodId: query.periodId,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Trial balance"
        description={`${resolved.label}. Consolidated figures are rolled up by consolidation code after inter-company elimination.`}
      />
      <Surface className="mb-4">
        <form method="get" className="flex flex-wrap gap-3 px-4 py-3">
          {scope ? <input type="hidden" name="scope" value={scope} /> : null}
          <label className="text-[12px] font-semibold text-ink-700">
            Period
            <select name="periodId" defaultValue={query.periodId ?? ''} className={`mt-1 ${CONTROL_CLASS}`}>
              <option value="">All posted</option>
              {(yearForPeriods?.periods ?? []).map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="self-end border border-ink-300 px-3 py-1.5 text-[13px]">
            Apply
          </button>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader
          title="Posted balances"
          description={`Debits ${formatKobo(BigInt(trial.debitTotalKobo))} · Credits ${formatKobo(BigInt(trial.creditTotalKobo))}${
            trial.eliminationTotalKobo ? ` · Eliminations ${formatKobo(BigInt(trial.eliminationTotalKobo))}` : ''
          }. Open an account to drill ledger postings.`}
        />
        {trial.rows.length === 0 ? (
          <EmptyState title="No posted balances" description="Post a journal to populate the trial balance." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Account</th>
                <th className="px-4 py-2 font-semibold">Entity</th>
                <th className="px-4 py-2 font-semibold">Debit</th>
                <th className="px-4 py-2 font-semibold">Credit</th>
              </tr>
            </thead>
            <tbody>
              {trial.rows.map((row) => {
                const drillHref = withScope(
                  `/finance/reports/drill?accountCodes=${encodeURIComponent(row.accountCode)}${
                    query.periodId ? `&periodId=${query.periodId}` : ''
                  }`,
                  scope,
                );
                return (
                  <tr key={`${row.accountId}-${row.entityId}`} className="border-b border-ink-100">
                    <td className="px-4 py-2">
                      <Link href={drillHref} className="underline">
                        {row.accountCode} {row.accountName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{row.entityCode}</td>
                    <td className="tabular px-4 py-2">
                      {row.debitKobo ? (
                        <Link href={drillHref} className="underline">
                          {formatKobo(BigInt(row.debitKobo))}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tabular px-4 py-2">
                      {row.creditKobo ? (
                        <Link href={drillHref} className="underline">
                          {formatKobo(BigInt(row.creditKobo))}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
