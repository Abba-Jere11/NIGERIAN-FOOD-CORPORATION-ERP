import type { BudgetActivityMetric, BudgetActivityView, FinanceContextView, MeView } from '@nfc/shared';
import { formatKobo, hasFinanceNavPermission } from '@nfc/shared';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch, ApiError } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Budget activity — NFC' };

const METRICS: BudgetActivityMetric[] = ['approved', 'committed', 'paid', 'available'];

function isMetric(value: string | undefined): value is BudgetActivityMetric {
  return Boolean(value && METRICS.includes(value as BudgetActivityMetric));
}

export default async function BudgetActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; metric?: string; budgetId?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasFinanceNavPermission(me.permissions)) redirect('/forbidden');
  const query = await searchParams;
  if (!isMetric(query.metric)) notFound();

  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;

  let activity: BudgetActivityView;
  try {
    activity = await apiFetch<BudgetActivityView>('/api/finance/budget-activity', {
      query: {
        metric: query.metric,
        entityId: resolved.consolidated ? undefined : resolved.entityId,
        budgetId: query.budgetId,
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
        title={activity.title}
        description={activity.definition}
        actions={
          <Link href={withScope('/finance/budgets', scope)} className="text-[13px] underline">
            All budgets
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="border border-ink-200 bg-surface px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-ink-500">Entries</p>
          <p className="tabular text-[20px] font-semibold text-ink-900">{activity.rows.length}</p>
        </div>
        <div className="border border-ink-200 bg-surface px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-ink-500">Total</p>
          <p className="tabular text-[20px] font-semibold text-ink-900">{formatKobo(BigInt(activity.totalKobo))}</p>
        </div>
      </div>
      <nav aria-label="Budget metrics" className="mb-4 flex flex-wrap gap-1">
        {METRICS.map((metric) => {
          const href = withScope(
            `/finance/budgets/activity?metric=${metric}${query.budgetId ? `&budgetId=${query.budgetId}` : ''}`,
            scope,
          );
          const active = metric === query.metric;
          return (
            <Link
              key={metric}
              href={href}
              className={
                active
                  ? 'bg-accent-50 px-2 py-1 text-[13px] font-medium text-accent-900'
                  : 'px-2 py-1 text-[13px] text-ink-700 hover:bg-ink-100'
              }
            >
              {metric.charAt(0).toUpperCase() + metric.slice(1)}
            </Link>
          );
        })}
      </nav>
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} description="Open a row for the underlying request or budget." />
        {activity.rows.length === 0 ? (
          <EmptyState title="No rows" description="Nothing matches this metric in the current scope." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 font-semibold">Entity</th>
                <th className="px-4 py-2 font-semibold">Line</th>
                <th className="px-4 py-2 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {activity.rows.map((row, index) => (
                <tr key={`${row.href}-${row.reference}-${index}`} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.date}</td>
                  <td className="px-4 py-2">
                    <Link href={row.href} className="underline">
                      {row.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.description}</td>
                  <td className="px-4 py-2">{row.entityCode ?? '—'}</td>
                  <td className="px-4 py-2">{row.budgetLineCode ?? '—'}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.amountKobo))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
