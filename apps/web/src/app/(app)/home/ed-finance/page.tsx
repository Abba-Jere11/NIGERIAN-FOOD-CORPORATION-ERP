import type {
  BudgetView,
  FinanceDashboardView,
  FinanceOverrideView,
  FinanceQueuesView,
  JournalView,
  MeView,
  ProcurementListView,
  WorkflowPendingView,
} from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — ED Finance — NFC' };

export default async function EdFinanceHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('finance.funding.authorize')) redirect('/forbidden');

  const [dashboard, queues, list, pending, overrides, journals, budgets] = await Promise.all([
    apiFetch<FinanceDashboardView>('/api/finance/dashboard').catch(() => null),
    apiFetch<FinanceQueuesView>('/api/finance/queues').catch(() => null),
    apiFetch<ProcurementListView>('/api/procurement').catch(
      () => ({ items: [], counts: {} }) as ProcurementListView,
    ),
    apiFetch<WorkflowPendingView[]>('/api/workflows/pending').catch(() => [] as WorkflowPendingView[]),
    apiFetch<FinanceOverrideView[]>('/api/procurement/finance-overrides').catch(
      () => [] as FinanceOverrideView[],
    ),
    apiFetch<JournalView[]>('/api/finance/journals').catch(() => [] as JournalView[]),
    apiFetch<BudgetView[]>('/api/finance/budgets').catch(() => [] as BudgetView[]),
  ]);

  const primary = dashboard?.consolidated ?? dashboard?.entities[0] ?? null;
  const atFinance = list.items.filter((item) => item.status === 'AWAITING_ED_FINANCE');
  const financeReview = atFinance.filter((item) => item.invoiceStage === 'ready');
  const awaitingInvoice = atFinance.filter((item) => item.invoiceStage !== 'ready');
  const funding = list.items.filter((item) => item.status === 'FUNDING_PENDING');
  const routeB = list.items.filter((item) => item.status === 'AWAITING_PAYMENT');
  const journalsPending = journals.filter((row) => row.status === 'PENDING_APPROVAL');
  const budgetsPending = budgets.filter((row) => row.status === 'PENDING_APPROVAL');
  const financeWorkflow = pending.filter((row) =>
    ['JOURNAL', 'BUDGET', 'INCOME', 'EXPENSE', 'BILL'].includes(row.subjectType ?? ''),
  );

  return (
    <>
      <PageHeader
        eyebrow="Corporate · Finance"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Group position plus funding, review and payment queues."
        actions={
          <ButtonLink href="/finance?scope=consolidated" variant="secondary">
            Open finance
          </ButtonLink>
        }
      />
      <PendingActionsPanel />

      {primary ? (
        <>
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <HomeKpiCard
              label="Cash position"
              value={formatKobo(BigInt(primary.cashPositionKobo))}
              href="/finance/bank"
            />
            <HomeKpiCard
              label="Outstanding receivables"
              value={formatKobo(BigInt(primary.outstandingReceivablesKobo))}
              href="/finance/receivables"
            />
            <HomeKpiCard
              label="Outstanding payables"
              value={formatKobo(BigInt(primary.outstandingPayablesKobo))}
              href="/finance/payables"
            />
            <HomeKpiCard
              label="Total revenue"
              value={formatKobo(BigInt(primary.totalRevenueKobo))}
              href="/finance/income"
            />
            <HomeKpiCard
              label="Total expenditure"
              value={formatKobo(BigInt(primary.totalExpenditureKobo))}
              href="/finance/expenses"
            />
            <HomeKpiCard
              label="Profit / loss"
              value={formatKobo(BigInt(primary.profitLossKobo))}
              href="/finance/trial-balance"
            />
            {me.permissions.includes('payroll.view') ? (
              <HomeKpiCard
                label="Payroll"
                value={formatKobo(BigInt(primary.payrollCostKobo))}
                href="/finance/reports/payroll_summary"
              />
            ) : null}
          </div>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <HomeKpiCard
              label="Total budget"
              value={formatKobo(BigInt(primary.totalBudgetKobo))}
              href="/finance/budgets"
            />
            <HomeKpiCard
              label="Available balance"
              value={formatKobo(BigInt(primary.availableBudgetKobo))}
              href="/finance/budgets/activity?metric=available"
            />
            <HomeKpiCard
              label="Budget utilization"
              value={formatKobo(BigInt(primary.budgetUtilizationKobo))}
              href="/finance/budgets/activity?metric=paid"
            />
            <HomeKpiCard
              label="Procurement commitments"
              value={formatKobo(BigInt(primary.procurementCommitmentsKobo))}
              href="/finance/budgets/activity?metric=committed"
            />
            <HomeKpiCard
              label="Inter-company transfers"
              value={formatKobo(BigInt(primary.intercompanyTransfersKobo))}
              href="/finance/intercompany"
            />
          </div>
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader
              title="Ready for your approval"
              description="The vendor invoice is attached and matches. Review the checks and approve funding."
            />
            <HomeQueueTable
              rows={financeReview.map((item) => ({
                id: item.id,
                reference: item.referenceNumber,
                title: item.title,
                meta: [item.entityCode, item.vendorName, item.originatorName].filter(Boolean).join(' · '),
                amountKobo: item.totalAmountKobo,
                href: `/procurement/${item.id}#finance`,
              }))}
              emptyTitle="No financial reviews waiting"
            />
          </Surface>

          {awaitingInvoice.length > 0 ? (
            <Surface padded={false}>
              <SurfaceHeader
                title="Waiting for the vendor invoice"
                description="Approved by the MD. Approval opens once the Procurement Manager attaches a matching invoice."
              />
              <HomeQueueTable
                rows={awaitingInvoice.map((item) => ({
                  id: item.id,
                  reference: item.referenceNumber,
                  title: item.title,
                  meta: [
                    item.entityCode,
                    item.vendorName,
                    item.nextAction ? `${item.nextAction.label} (${item.nextAction.responsible})` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  amountKobo: item.totalAmountKobo,
                  href: `/procurement/${item.id}#invoice`,
                }))}
                emptyTitle="No requests waiting for an invoice"
              />
            </Surface>
          ) : null}

          <Surface padded={false}>
            <SurfaceHeader title="Funding transfers" description="FUNDING_PENDING — authorize Route A or B." />
            <HomeQueueTable
              rows={funding.map((item) => ({
                id: item.id,
                reference: item.referenceNumber,
                title: item.title,
                meta: [item.entityCode, item.vendorName].filter(Boolean).join(' · '),
                amountKobo: item.totalAmountKobo,
                href: `/procurement/${item.id}`,
              }))}
              emptyTitle="No funding transfers pending"
            />
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader title="Route B payments" description="AWAITING_PAYMENT — Holding execution." />
            <HomeQueueTable
              rows={routeB.map((item) => ({
                id: item.id,
                reference: item.referenceNumber,
                title: item.title,
                meta: [item.entityCode, item.vendorName].filter(Boolean).join(' · '),
                amountKobo: item.totalAmountKobo,
                href: `/procurement/${item.id}`,
              }))}
              emptyTitle="No Route B payments waiting"
            />
          </Surface>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Surface padded={false}>
              <SurfaceHeader
                title="Journals pending"
                description={`${queues?.pendingJournals ?? journalsPending.length} in queue`}
              />
              <HomeQueueTable
                rows={(journalsPending.length > 0
                  ? journalsPending.slice(0, 8).map((row) => ({
                      id: row.id,
                      reference: row.referenceNumber,
                      title: row.narration,
                      meta: row.entityCode,
                      amountKobo: row.debitTotalKobo,
                      href: `/finance/journals/${row.id}`,
                    }))
                  : financeWorkflow
                      .filter((row) => row.subjectType === 'JOURNAL')
                      .slice(0, 8)
                      .map((row) => ({
                        id: row.id,
                        reference: row.referenceNumber,
                        title: row.title,
                        meta: row.entityCode,
                        amountKobo: row.amountKobo,
                        href: row.href ?? '/finance/journals',
                      })))}
                emptyTitle="No journals pending"
                columns={['reference', 'meta', 'amount']}
              />
            </Surface>
            <Surface padded={false}>
              <SurfaceHeader
                title="Budgets pending"
                description={`${queues?.pendingBudgets ?? budgetsPending.length} in queue`}
              />
              <HomeQueueTable
                rows={budgetsPending.slice(0, 8).map((row) => ({
                  id: row.id,
                  reference: row.referenceNumber,
                  title: `FY ${row.year} · v${row.versionNumber}`,
                  meta: [row.entityCode, row.status].filter(Boolean).join(' · '),
                  amountKobo: row.lines.reduce((sum, line) => sum + line.approvedKobo, 0),
                  href: `/finance/budgets/${row.id}`,
                }))}
                emptyTitle="No budgets pending approval"
                columns={['reference', 'meta', 'amount']}
              />
            </Surface>
          </div>
        </div>

        <div className="space-y-4">
          <Surface>
            <h2 className="mb-2 text-[15px] font-semibold text-ink-900">Bank reconciliation</h2>
            <p className="tabular text-[22px] font-semibold text-ink-900">
              {queues?.unreconciledLines ?? 0}
            </p>
            <p className="text-[12px] text-ink-500">Unreconciled statement lines</p>
            <Link href="/finance/bank" className="mt-2 inline-block text-[13px] underline">
              Open bank
            </Link>
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader
              title="Flagged overrides"
              description="Financial checks that failed and were later approved with a reason."
            />
            <HomeQueueTable
              rows={overrides.map((row) => ({
                id: row.id,
                reference: row.referenceNumber,
                title: row.entityCode,
                meta: row.approvedAt.slice(0, 10),
                detail: [row.overrideReason, row.failedChecks.join(', ')].filter(Boolean).join(' · '),
                href: row.href,
                amountKobo: null,
              }))}
              columns={['reference', 'detail']}
              emptyTitle="No overrides flagged"
              emptyDescription="Override approvals will list here."
            />
          </Surface>
        </div>
      </div>
    </>
  );
}
