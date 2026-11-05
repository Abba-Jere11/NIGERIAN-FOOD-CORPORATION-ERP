import type {
  BankAccountView,
  BankStatementView,
  BankTransactionView,
  FinanceContextView,
  FiscalYearView,
  MeView,
  ReconciliationReportView,
} from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cx } from '@/lib/cx';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';
import { BankForms } from './BankForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bank — NFC' };

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; accountId?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<FinanceContextView>('/api/finance/context'),
  ]);
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const accounts = await apiFetch<BankAccountView[]>('/api/bank-accounts', {
    query: { entityId: resolved.entityId },
  }).catch(() => [] as BankAccountView[]);
  const selected = accounts.find((account) => account.id === query.accountId) ?? accounts[0];
  const [transactions, statements, report, years, reconByAccount] = selected
    ? await Promise.all([
        apiFetch<BankTransactionView[]>(`/api/finance/bank-accounts/${selected.id}/transactions`),
        apiFetch<BankStatementView[]>(`/api/finance/bank-accounts/${selected.id}/statements`),
        apiFetch<ReconciliationReportView>(`/api/finance/bank-accounts/${selected.id}/reconciliation`),
        apiFetch<FiscalYearView[]>('/api/finance/years', { query: { entityId: selected.entityId } }),
        Promise.all(
          accounts.map(async (account) => {
            try {
              const recon = await apiFetch<ReconciliationReportView>(
                `/api/finance/bank-accounts/${account.id}/reconciliation`,
              );
              return [account.id, recon.unmatchedStatementCount] as const;
            } catch {
              return [account.id, 0] as const;
            }
          }),
        ).then((pairs) => Object.fromEntries(pairs) as Record<string, number>),
      ])
    : [[], [], null, [], {} as Record<string, number>];
  const canManage = me.permissions.includes('finance.bank.manage');
  const canReconcile = me.permissions.includes('finance.reconcile');
  const periods = years.flatMap((year) => year.periods);

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Bank"
        description="Own-account transfers and statement matching. Procurement PAY/TRF stay off-ledger."
      />
      {accounts.length === 0 ? (
        <EmptyState title="No bank accounts" description="ED Finance maps operating accounts in treasury." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => {
              const active = selected?.id === account.id;
              const unmatched = reconByAccount[account.id] ?? 0;
              return (
                <Link
                  key={account.id}
                  href={withScope(`/finance/bank?accountId=${account.id}`, scope)}
                  className={cx(
                    'border bg-surface px-3 py-3 hover:bg-ink-50',
                    active ? 'border-accent-600' : 'border-ink-200',
                  )}
                >
                  <p className="text-[13px] font-medium text-ink-900">
                    {account.entityCode ? `${account.entityCode} · ` : ''}
                    {account.name}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-600">
                    {account.bankName} · {account.accountNumberMasked}
                  </p>
                  <p className="tabular mt-2 text-[16px] font-semibold text-ink-900">
                    {formatKobo(BigInt(account.recordedBalanceKobo))}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-500">
                    {account.glAccountId ? 'Mapped to GL cash' : 'Not mapped to GL'}
                    {unmatched > 0 ? ` · ${unmatched} unmatched` : ''}
                  </p>
                </Link>
              );
            })}
          </div>
          {selected ? (
            <Surface className="mb-4">
              <SurfaceHeader
                title={selected.name}
                description={`${selected.bankName} · ${selected.accountNumberMasked}`}
              />
              <p className="tabular px-4 py-3 text-[13px] text-ink-700">
                Recorded balance {formatKobo(BigInt(selected.recordedBalanceKobo))}
                {selected.glAccountId ? ' · mapped to a cash account' : ' · not mapped to GL'}
                {report ? ` · ${report.unmatchedStatementCount} unmatched statement lines` : ''}
              </p>
            </Surface>
          ) : null}
          {selected && (canManage || canReconcile) ? (
            <BankForms
              account={selected}
              accounts={accounts}
              periods={periods}
              report={report}
              canManage={canManage}
              canReconcile={canReconcile}
            />
          ) : null}
          <Surface className="mb-4" padded={false}>
            <SurfaceHeader title="Movements" />
            {transactions.length === 0 ? (
              <EmptyState title="No bank movements" description="Transfers and imported lines appear here." />
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-4 py-2 font-semibold">Kind</th>
                    <th className="px-4 py-2 font-semibold">Narration</th>
                    <th className="px-4 py-2 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr key={row.id} className="border-b border-ink-100">
                      <td className="px-4 py-2">{row.occurredOn}</td>
                      <td className="px-4 py-2">{row.kind}</td>
                      <td className="px-4 py-2">{row.narration}</td>
                      <td className="tabular px-4 py-2">{formatKobo(BigInt(row.amountKobo))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader
              title="Statements"
              description={
                report
                  ? `${report.matchedCount} matched · ${report.unmatchedStatementCount} unmatched`
                  : undefined
              }
            />
            {statements.length === 0 ? (
              <EmptyState title="No statements" description="Import a CSV or XLSX with date, description and amount columns." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {statements.map((statement) => (
                  <li key={statement.id} className="px-4 py-3 text-[13px]">
                    <p className="font-medium">{statement.reference}</p>
                    <p className="text-ink-500">{statement.lines.length} lines</p>
                    {statement.lines.map((line) => (
                      <p key={line.id} className="mt-1 flex justify-between gap-3">
                        <span>
                          {line.occurredOn} · {line.description}
                        </span>
                        <span className="tabular">
                          {formatKobo(BigInt(line.amountKobo))}{' '}
                          <StatusBadge status={line.matched ? 'MATCHED' : 'OPEN'} />
                        </span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </>
      )}
    </>
  );
}
