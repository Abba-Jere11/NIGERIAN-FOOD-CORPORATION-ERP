import type {
  BankTransactionView,
  BudgetView,
  ExpenseEntryView,
  FinanceContextView,
  FinanceDashboardView,
  FinanceQueuesView,
  IncomeEntryView,
  IntercompanyTransactionView,
  MeView,
  PayableInvoiceView,
} from '@nfc/shared';
import { hasFinanceNavPermission } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { BudgetProgressStrip } from './_components/BudgetProgressStrip';
import { EntityComparisonTable } from './_components/EntityComparisonTable';
import { KpiCard } from './_components/KpiCard';
import { RecentActivityList, type RecentActivityItem } from './_components/RecentActivityList';
import { resolveFinanceScope, withScope } from './scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Finance — NFC' };

const ACTIVITY_LIMIT = 8;

export default async function FinanceHomePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasFinanceNavPermission(me.permissions)) redirect('/forbidden');
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const entityQuery = resolved.consolidated || !resolved.entityId ? {} : { entityId: resolved.entityId };

  const [dashboard, queues, income, expenses, payables, intercompany, bankTx, budgets] = await Promise.all([
    apiFetch<FinanceDashboardView>('/api/finance/dashboard', { query: entityQuery }),
    apiFetch<FinanceQueuesView>('/api/finance/queues'),
    apiFetch<IncomeEntryView[]>('/api/finance/income', { query: entityQuery }).catch(() => [] as IncomeEntryView[]),
    apiFetch<ExpenseEntryView[]>('/api/finance/expenses', { query: entityQuery }).catch(() => [] as ExpenseEntryView[]),
    apiFetch<PayableInvoiceView[]>('/api/finance/payables', { query: entityQuery }).catch(() => [] as PayableInvoiceView[]),
    apiFetch<IntercompanyTransactionView[]>('/api/finance/intercompany').catch(() => [] as IntercompanyTransactionView[]),
    !resolved.consolidated && resolved.entityId
      ? apiFetch<{ id: string }[]>('/api/bank-accounts', { query: { entityId: resolved.entityId } })
          .then(async (accounts) => {
            const first = accounts[0];
            if (!first) return [] as BankTransactionView[];
            return apiFetch<BankTransactionView[]>(`/api/finance/bank-accounts/${first.id}/transactions`).catch(
              () => [] as BankTransactionView[],
            );
          })
          .catch(() => [] as BankTransactionView[])
      : Promise.resolve([] as BankTransactionView[]),
    apiFetch<BudgetView[]>('/api/finance/budgets', { query: entityQuery }).catch(() => [] as BudgetView[]),
  ]);
  const headroomLines = budgets.flatMap((budget) => budget.lines);

  const primary = resolved.consolidated ? dashboard.consolidated : dashboard.entities[0];
  const activity = buildRecentActivity({
    scope,
    income,
    expenses,
    payables,
    intercompany: resolved.consolidated
      ? intercompany
      : intercompany.filter(
          (row) => row.sourceEntityId === resolved.entityId || row.destinationEntityId === resolved.entityId,
        ),
    bankTx,
  });

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Position"
        description={
          resolved.consolidated
            ? 'Group totals from posted ledgers, live payables and receivables. Staff costs stay out of this milestone.'
            : `Live position for ${resolved.label}.`
        }
      />

      {primary ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label="Cash position" valueKobo={primary.cashPositionKobo} href="/finance/bank" scope={scope} />
            <KpiCard
              label="Outstanding receivables"
              valueKobo={primary.outstandingReceivablesKobo}
              href="/finance/receivables"
              scope={scope}
            />
            <KpiCard
              label="Outstanding payables"
              valueKobo={primary.outstandingPayablesKobo}
              href="/finance/payables"
              scope={scope}
            />
            <KpiCard label="Total revenue" valueKobo={primary.totalRevenueKobo} href="/finance/income" scope={scope} />
            <KpiCard
              label="Total expenditure"
              valueKobo={primary.totalExpenditureKobo}
              href="/finance/expenses"
              scope={scope}
            />
            <KpiCard label="Profit / loss" valueKobo={primary.profitLossKobo} href="/finance/trial-balance" scope={scope} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label="Total budget" valueKobo={primary.totalBudgetKobo} href="/finance/budgets" scope={scope} compact />
            <KpiCard
              label="Available balance"
              valueKobo={primary.availableBudgetKobo}
              href="/finance/budgets/activity?metric=available"
              scope={scope}
              compact
            />
            <KpiCard
              label="Budget utilization"
              valueKobo={primary.budgetUtilizationKobo}
              href="/finance/budgets/activity?metric=paid"
              scope={scope}
              compact
            />
            <KpiCard
              label="Procurement commitments"
              valueKobo={primary.procurementCommitmentsKobo}
              href="/finance/budgets/activity?metric=committed"
              scope={scope}
              compact
            />
            <KpiCard
              label="Inter-company transfers"
              valueKobo={primary.intercompanyTransfersKobo}
              href="/finance/intercompany"
              scope={scope}
              compact
            />
          </div>
        </>
      ) : null}

      {headroomLines.length > 0 ? (
        <Surface className="mt-6" padded={false}>
          <SurfaceHeader
            title="Budget headroom"
            description="Open Approved, Committed, Paid or Available to see the underlying lines and procurement."
          />
          <BudgetProgressStrip lines={headroomLines} scope={scope} />
        </Surface>
      ) : null}

      {resolved.consolidated && dashboard.entities.length > 0 ? (
        <Surface className="mt-6" padded={false}>
          <SurfaceHeader title="Entity comparison" description="Open an entity to switch the finance scope." />
          <EntityComparisonTable entities={dashboard.entities} />
        </Surface>
      ) : null}

      <Surface className="mt-6" padded={false}>
        <SurfaceHeader title="Recent activity" description="Latest income, expenses, payables and transfers in scope." />
        <RecentActivityList items={activity} />
      </Surface>

      <Surface className="mt-6" padded={false}>
        <SurfaceHeader title="Attention" description="Queues that need a decision or match." />
        <div className="grid grid-cols-1 gap-0 divide-y divide-ink-100 md:grid-cols-3 md:divide-x md:divide-y-0">
          <Link href={withScope('/finance/journals', scope)} className="px-4 py-3 hover:bg-ink-50">
            <p className="text-[11px] uppercase tracking-wider text-ink-500">Journals awaiting approval</p>
            <p className="tabular text-[20px] font-semibold text-ink-900">{queues.pendingJournals}</p>
          </Link>
          <Link href={withScope('/finance/budgets', scope)} className="px-4 py-3 hover:bg-ink-50">
            <p className="text-[11px] uppercase tracking-wider text-ink-500">Budgets awaiting approval</p>
            <p className="tabular text-[20px] font-semibold text-ink-900">{queues.pendingBudgets}</p>
          </Link>
          <Link href={withScope('/finance/bank', scope)} className="px-4 py-3 hover:bg-ink-50">
            <p className="text-[11px] uppercase tracking-wider text-ink-500">Unreconciled statement lines</p>
            <p className="tabular text-[20px] font-semibold text-ink-900">{queues.unreconciledLines}</p>
          </Link>
        </div>
      </Surface>
    </>
  );
}

function buildRecentActivity({
  scope,
  income,
  expenses,
  payables,
  intercompany,
  bankTx,
}: {
  scope?: string;
  income: IncomeEntryView[];
  expenses: ExpenseEntryView[];
  payables: PayableInvoiceView[];
  intercompany: IntercompanyTransactionView[];
  bankTx: BankTransactionView[];
}): RecentActivityItem[] {
  const items: RecentActivityItem[] = [
    ...income.map((row) => ({
      ref: row.referenceNumber,
      date: row.occurredOn,
      description: row.narration || row.categoryName,
      entityCode: row.entityCode,
      amountKobo: row.amountKobo,
      href: withScope(`/finance/income/${row.id}`, scope),
    })),
    ...expenses.map((row) => ({
      ref: row.referenceNumber,
      date: row.occurredOn,
      description: row.narration || row.categoryName,
      entityCode: row.entityCode,
      amountKobo: row.amountKobo,
      href: withScope(`/finance/expenses/${row.id}`, scope),
    })),
    ...payables.map((row) => ({
      ref: row.referenceNumber,
      date: row.invoiceDate,
      description: row.vendorName ?? row.source,
      entityCode: row.entityCode,
      amountKobo: row.outstandingKobo,
      href: withScope(`/finance/payables/${row.id}`, scope),
    })),
    ...intercompany.map((row) => ({
      ref: row.referenceNumber,
      date: row.occurredOn,
      description: row.narration || `${row.sourceEntityCode ?? '?'} → ${row.destinationEntityCode ?? '?'}`,
      entityCode: row.sourceEntityCode,
      amountKobo: row.amountKobo,
      href: withScope(`/finance/intercompany/${row.id}`, scope),
    })),
    ...bankTx.map((row) => ({
      ref: row.kind,
      date: row.occurredOn,
      description: row.narration,
      entityCode: null,
      amountKobo: row.amountKobo,
      href: withScope('/finance/bank', scope),
    })),
  ];

  return items
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, ACTIVITY_LIMIT);
}
