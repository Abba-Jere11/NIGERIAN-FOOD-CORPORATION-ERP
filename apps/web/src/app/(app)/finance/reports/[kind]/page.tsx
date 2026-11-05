import type { FinanceContextView, FiscalYearView, MeView, ReportKind, ReportView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONTROL_CLASS } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../../scope';
import { ShareReportDialog } from '../ShareReportDialog';

export const dynamic = 'force-dynamic';

const TITLES: Partial<Record<ReportKind, string>> = {
  income_statement: 'Income statement',
  balance_sheet: 'Balance sheet',
  cash_flow: 'Cash-flow statement',
  trial_balance: 'Trial balance',
  general_ledger: 'General ledger',
  budget_vs_actual: 'Budget vs actual',
  expense_analysis: 'Expense analysis',
  revenue_analysis: 'Revenue analysis',
  payables: 'Payables',
  receivables_aging: 'Receivables aging',
  procurement_expenditure: 'Procurement expenditure',
  subsidiary_comparison: 'Subsidiary comparison',
  consolidated_statements: 'Consolidated statements',
  intercompany: 'Inter-company',
  payroll_summary: 'Payroll summary',
  eliminations: 'Eliminations',
};

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ scope?: string; periodId?: string; ytd?: string; year?: string }>;
}) {
  const { kind } = await params;
  const query = await searchParams;
  const title = TITLES[kind as ReportKind];
  if (!title) notFound();
  const me = await apiFetch<MeView>('/api/me');
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const years = await apiFetch<FiscalYearView[]>('/api/finance/years', {
    query: { entityId: resolved.entityId, consolidated: resolved.consolidated ? 'true' : undefined },
  });
  const yearForPeriods = years.find((year) => year.entityCode === 'NFC') ?? years[0];
  const periods = (yearForPeriods?.periods ?? []).map((period) => ({
    ...period,
    year: yearForPeriods?.year ?? 2026,
  }));
  let report: ReportView;
  try {
    report = await apiFetch<ReportView>(`/api/finance/reports/${kind}`, {
      query: {
        entityId: resolved.entityId,
        consolidated: resolved.consolidated ? 'true' : undefined,
        periodId: query.periodId,
        ytd: query.ytd,
        year: query.year ?? '2026',
      },
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title={report.title}
        description={`${report.entityLabel} · ${report.periodLabel} · ${report.runReference}`}
        actions={
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            {me.permissions.includes('reports.email') ? (
              <ShareReportDialog
                report={report}
                kind={kind}
                senderName={me.name}
                entityId={resolved.entityId}
                consolidated={resolved.consolidated}
                periodId={query.periodId}
                year={query.year ?? '2026'}
                ytd={query.ytd === 'true'}
              />
            ) : null}
            {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
              <Link
                key={format}
                href={withScope(
                  `/finance/reports/${kind}/export?format=${format}${query.periodId ? `&periodId=${query.periodId}` : ''}${query.year ? `&year=${query.year}` : ''}`,
                  scope,
                )}
                className="underline"
              >
                {format.toUpperCase()}
              </Link>
            ))}
          </span>
        }
      />
      <Surface className="mb-4">
        <form method="get" className="flex flex-wrap gap-3 px-4 py-3">
          {scope ? <input type="hidden" name="scope" value={scope} /> : null}
          <label className="text-[12px] font-semibold text-ink-700">
            Period
            <select name="periodId" defaultValue={query.periodId ?? ''} className={`mt-1 ${CONTROL_CLASS}`}>
              <option value="">All / year</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.year} {period.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 text-[12px] font-semibold text-ink-700">
            <input type="checkbox" name="ytd" value="true" defaultChecked={query.ytd === 'true'} />
            Year to date
          </label>
          <button type="submit" className="self-end border border-ink-300 px-3 py-1.5 text-[13px]">
            Run
          </button>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader
          title="Results"
          description={[
            report.notes?.join(' '),
            'Underlined amounts open the ledger drill for those accounts.',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {report.emptyState ? (
          <EmptyState title={report.emptyState.title} description={report.emptyState.description} />
        ) : report.rows.length === 0 ? (
          <EmptyState title="No figures" description="Nothing posted in this window." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Line</th>
                {report.columns.map((column) => (
                  <th key={column} className="px-4 py-2 font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const drill = row.cells.drill;
                const href = drill
                  ? withScope(
                      `/finance/reports/drill?accountCodes=${encodeURIComponent(drill.accountCodes.join(','))}${
                        drill.periodId ? `&periodId=${drill.periodId}` : ''
                      }`,
                      scope,
                    )
                  : null;
                return (
                  <tr key={row.key} className="border-b border-ink-100">
                    <td className={`px-4 py-2 ${row.bold ? 'font-semibold' : ''}`}>{row.label}</td>
                    <td className="tabular px-4 py-2">
                      {href ? (
                        <Link href={href} className="underline">
                          {formatKobo(BigInt(row.cells.currentKobo))}
                        </Link>
                      ) : (
                        formatKobo(BigInt(row.cells.currentKobo))
                      )}
                    </td>
                    {report.columns.includes('Comparison') ? (
                      <td className="tabular px-4 py-2">
                        {formatKobo(BigInt(row.cells.compareKobo ?? 0))}
                      </td>
                    ) : null}
                    {report.columns.includes('Variance') ? (
                      <td className="tabular px-4 py-2">
                        {formatKobo(BigInt(row.cells.varianceKobo ?? 0))}
                      </td>
                    ) : null}
                    {report.columns.includes('Credit') ? (
                      <td className="tabular px-4 py-2">
                        {formatKobo(BigInt(row.cells.compareKobo ?? 0))}
                      </td>
                    ) : null}
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
