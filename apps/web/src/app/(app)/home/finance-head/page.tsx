import type {
  BudgetView,
  FinanceDashboardView,
  FinanceQueuesView,
  MeView,
  PayableInvoiceView,
  ProcurementListView,
  PayrollRunListItemView,
  RecentProcurementPaymentView,
  ReceivableInvoiceView,
} from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { startOfUtcWeek } from '@/components/home/date-helpers';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { BudgetProgressStrip } from '@/app/(app)/finance/_components/BudgetProgressStrip';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — Finance Head — NFC' };

function endOfUtcWeek(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export default async function FinanceHeadHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('finance.payment.execute')) redirect('/forbidden');
  const weekStart = startOfUtcWeek();
  const weekEnd = endOfUtcWeek(weekStart);
  const entityId = me.entities[0]?.id;

  const [list, dashboard, payables, receivables, queues, budgets, recentPayments, payrollRuns] = await Promise.all([
    apiFetch<ProcurementListView>('/api/procurement').catch(
      () => ({ items: [], counts: {} }) as ProcurementListView,
    ),
    me.permissions.includes('finance.dashboard.entity') || me.permissions.includes('finance.view')
      ? apiFetch<FinanceDashboardView>('/api/finance/dashboard', {
          query: entityId ? { entityId } : {},
        }).catch(() => null)
      : Promise.resolve(null),
    apiFetch<PayableInvoiceView[]>('/api/finance/payables', {
      query: entityId ? { entityId } : {},
    }).catch(() => [] as PayableInvoiceView[]),
    apiFetch<ReceivableInvoiceView[]>('/api/finance/receivables', {
      query: entityId ? { entityId } : {},
    }).catch(() => [] as ReceivableInvoiceView[]),
    apiFetch<FinanceQueuesView>('/api/finance/queues').catch(() => null),
    apiFetch<BudgetView[]>('/api/finance/budgets', {
      query: entityId ? { entityId } : {},
    }).catch(() => [] as BudgetView[]),
    apiFetch<RecentProcurementPaymentView[]>('/api/procurement/payments/recent', {
      query: { limit: 12 },
    }).catch(() => [] as RecentProcurementPaymentView[]),
    me.permissions.includes('payroll.pay')
      ? apiFetch<PayrollRunListItemView[]>('/api/payroll/runs').catch(() => [] as PayrollRunListItemView[])
      : Promise.resolve([] as PayrollRunListItemView[]),
  ]);
  const payrollQueue = payrollRuns.filter((row) => row.status === 'LOCKED');

  const awaitingPayment = list.items.filter((item) => item.status === 'AWAITING_PAYMENT');
  const awaitingAmount = awaitingPayment.reduce((sum, item) => sum + (item.totalAmountKobo ?? 0), 0);
  const overduePayables = payables.filter((row) => row.overdue && row.outstandingKobo > 0);
  const dueThisWeek = payables.filter((row) => {
    if (row.outstandingKobo <= 0 || row.overdue) return false;
    const due = new Date(row.dueDate);
    return due.getTime() >= weekStart.getTime() && due.getTime() < weekEnd.getTime();
  });
  const tiles = dashboard?.entities[0] ?? null;
  const approvedLines = budgets.filter((row) => row.status === 'APPROVED').flatMap((row) => row.lines);
  const arOutstanding = receivables.reduce((sum, row) => sum + row.outstandingKobo, 0);
  const apOutstanding = payables.reduce((sum, row) => sum + row.outstandingKobo, 0);

  return (
    <>
      <PageHeader
        eyebrow={me.entities[0]?.name ?? 'Subsidiary'}
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Payments to execute, payables pressure, and recent settlement activity."
      />
      <PendingActionsPanel />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <HomeKpiCard
          label="Awaiting payment"
          value={awaitingPayment.length}
          href="/procurement?status=AWAITING_PAYMENT"
          hint={formatKobo(BigInt(awaitingAmount))}
          danger={awaitingPayment.length > 0}
        />
        <HomeKpiCard
          label="Payables overdue"
          value={overduePayables.length}
          href="/finance/payables"
          danger={overduePayables.length > 0}
          hint={formatKobo(BigInt(overduePayables.reduce((s, r) => s + r.outstandingKobo, 0)))}
        />
        <HomeKpiCard
          label="Payables due this week"
          value={dueThisWeek.length}
          href="/finance/payables"
          hint={formatKobo(BigInt(dueThisWeek.reduce((s, r) => s + r.outstandingKobo, 0)))}
        />
        <HomeKpiCard
          label="Bank balance"
          value={formatKobo(BigInt(tiles?.cashPositionKobo ?? 0))}
          href="/finance/bank"
        />
        <HomeKpiCard
          label="Budget available"
          value={formatKobo(BigInt(tiles?.availableBudgetKobo ?? 0))}
          href="/finance/budgets"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Pay now" description="Procurement awaiting payment at your subsidiary." />
            <HomeQueueTable
              rows={awaitingPayment.map((item) => ({
                id: item.id,
                reference: item.referenceNumber,
                title: item.title,
                meta: [item.vendorName, item.originatorName].filter(Boolean).join(' · '),
                amountKobo: item.totalAmountKobo,
                href: `/procurement/${item.id}`,
                actionLabel: 'Pay now',
                actionHref: `/procurement/${item.id}`,
              }))}
              columns={['reference', 'meta', 'amount', 'action']}
              emptyTitle="Nothing awaiting payment"
              emptyDescription="Route A payments for your entity appear here when funding clears."
            />
          </Surface>

          {me.permissions.includes('payroll.pay') ? (
            <Surface padded={false}>
              <SurfaceHeader title="Payroll to pay" description="Locked runs waiting for payment evidence." />
              <HomeQueueTable
                rows={payrollQueue.map((row) => ({
                  id: row.id,
                  reference: row.referenceNumber,
                  title: row.periodName ?? 'Payroll',
                  meta: row.entityCode ?? '',
                  amountKobo: row.netKobo,
                  href: `/hr/payroll/${row.id}`,
                  actionLabel: 'Pay',
                  actionHref: `/hr/payroll/${row.id}`,
                }))}
                columns={['reference', 'meta', 'amount', 'action']}
                emptyTitle="No locked payroll"
                emptyDescription="Approved payroll runs appear here after Finance Head or ED Finance lock them."
              />
            </Surface>
          ) : null}

          <Surface padded={false}>
            <SurfaceHeader title="Recent payments" description="Completed procurement settlements." />
            <HomeQueueTable
              rows={recentPayments.map((row) => ({
                id: row.id,
                reference: row.referenceNumber,
                title: row.procurementReference,
                meta: [row.entityCode, row.vendorName, row.paidAt.slice(0, 10)].filter(Boolean).join(' · '),
                amountKobo: row.amountKobo,
                href: row.href,
              }))}
              emptyTitle="No recent payments"
              emptyDescription="Settled vendor payments will list here."
            />
          </Surface>
        </div>

        <div className="space-y-4">
          <Surface>
            <h2 className="mb-3 text-[15px] font-semibold text-ink-900">AP / AR summary</h2>
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Payables outstanding</dt>
                <dd className="tabular font-medium">{formatKobo(BigInt(apOutstanding))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Receivables outstanding</dt>
                <dd className="tabular font-medium">{formatKobo(BigInt(arOutstanding))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-500">Unreconciled lines</dt>
                <dd className="tabular font-medium">{queues?.unreconciledLines ?? 0}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px]">
              <Link href="/finance/payables" className="underline">
                Payables
              </Link>
              {' · '}
              <Link href="/finance/receivables" className="underline">
                Receivables
              </Link>
              {' · '}
              <Link href="/finance/bank" className="underline">
                Bank
              </Link>
            </p>
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader title="Budget utilization" description="Approved lines for your entity." />
            {approvedLines.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-500">No approved budget lines in view.</p>
            ) : (
              <BudgetProgressStrip lines={approvedLines} />
            )}
          </Surface>
        </div>
      </div>
    </>
  );
}
