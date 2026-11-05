import type {
  EntityView,
  FinanceDashboardView,
  HrDisciplinaryView,
  IntercompanyTransactionView,
  MeView,
  OrgReportDashboardView,
  OverdueWorkflowView,
  PayableInvoiceView,
  ProcurementListView,
  WorkflowPendingView,
} from '@nfc/shared';
import { MAJOR_TRANSACTION_THRESHOLD_KOBO, formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  PROCUREMENT_HOME_TILE_STATUSES,
  PROCUREMENT_TILE_LABELS,
} from '@nfc/shared';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { HomeStatusTiles } from '@/components/home/HomeStatusTiles';
import { InventorySnapshot } from '@/components/home/InventorySnapshot';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — MD — NFC' };

type MajorRow = {
  id: string;
  reference: string;
  title: string;
  meta: string;
  amountKobo: number;
  href: string;
};

export default async function MdHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('procurement.approve.final')) redirect('/forbidden');

  const orgDash = me.permissions.includes('org_report.forward')
    ? await apiFetch<OrgReportDashboardView>('/api/org-reports/dashboard').catch(() => null)
    : null;
  const [pending, overdue, list, dashboard, entities, payables, intercompany] = await Promise.all([
    apiFetch<WorkflowPendingView[]>('/api/workflows/pending').catch(() => [] as WorkflowPendingView[]),
    me.permissions.includes('oversight.overdue.view')
      ? apiFetch<OverdueWorkflowView[]>('/api/workflows/overdue').catch(() => [] as OverdueWorkflowView[])
      : Promise.resolve([] as OverdueWorkflowView[]),
    apiFetch<ProcurementListView>('/api/procurement').catch(
      () => ({ items: [], counts: {} }) as ProcurementListView,
    ),
    me.permissions.includes('finance.dashboard.consolidated') || me.permissions.includes('finance.view')
      ? apiFetch<FinanceDashboardView>('/api/finance/dashboard').catch(() => null)
      : Promise.resolve(null),
    apiFetch<EntityView[]>('/api/entities').catch(() => [] as EntityView[]),
    me.permissions.includes('finance.view')
      ? apiFetch<PayableInvoiceView[]>('/api/finance/payables').catch(() => [] as PayableInvoiceView[])
      : Promise.resolve([] as PayableInvoiceView[]),
    me.permissions.includes('finance.view')
      ? apiFetch<IntercompanyTransactionView[]>('/api/finance/intercompany').catch(
          () => [] as IntercompanyTransactionView[],
        )
      : Promise.resolve([] as IntercompanyTransactionView[]),
  ]);
  const kpis = me.permissions.includes('inventory.view')
    ? await apiFetch<{ onHandValueKobo: number; expectedLines: number; lowStockCount: number }>(
        '/api/inventory/kpis',
      ).catch(() => ({ onHandValueKobo: 0, expectedLines: 0, lowStockCount: 0 }))
    : { onHandValueKobo: 0, expectedLines: 0, lowStockCount: 0 };

  const discPending = me.permissions.includes('hr.disciplinary.approve')
    ? await apiFetch<HrDisciplinaryView[]>('/api/hr/disciplinary').catch(() => [] as HrDisciplinaryView[])
    : [];
  const awaitingMd = discPending.filter((row) => row.status === 'AWAITING_MD');
  const myApprovals = pending.filter(
    (row) =>
      row.subjectType === 'PROCUREMENT' ||
      row.subjectType === 'HR_DISCIPLINARY' ||
      !row.subjectType,
  );
  const consolidated = dashboard?.consolidated ?? null;
  const utilizationPct =
    consolidated && consolidated.totalBudgetKobo > 0
      ? Math.round((consolidated.budgetUtilizationKobo / consolidated.totalBudgetKobo) * 100)
      : null;

  const majorFromProcurement: MajorRow[] = list.items
    .filter((item) => (item.totalAmountKobo ?? 0) >= MAJOR_TRANSACTION_THRESHOLD_KOBO)
    .map((item) => ({
      id: `proc-${item.id}`,
      reference: item.referenceNumber,
      title: item.title,
      meta: [item.entityCode, item.status.replaceAll('_', ' '), item.vendorName]
        .filter(Boolean)
        .join(' · '),
      amountKobo: item.totalAmountKobo ?? 0,
      href: `/procurement/${item.id}`,
    }));
  const majorFromPayables: MajorRow[] = payables
    .filter((row) => row.amountKobo >= MAJOR_TRANSACTION_THRESHOLD_KOBO)
    .map((row) => ({
      id: `ap-${row.id}`,
      reference: row.referenceNumber,
      title: row.vendorName ?? 'Payable',
      meta: [row.entityCode, row.status, 'Payable'].filter(Boolean).join(' · '),
      amountKobo: row.amountKobo,
      href: `/finance/payables/${row.id}`,
    }));
  const majorFromIc: MajorRow[] = intercompany
    .filter((row) => row.amountKobo >= MAJOR_TRANSACTION_THRESHOLD_KOBO)
    .map((row) => ({
      id: `ic-${row.id}`,
      reference: row.referenceNumber,
      title: row.type.replaceAll('_', ' '),
      meta: 'Intercompany',
      amountKobo: row.amountKobo,
      href: `/finance/intercompany/${row.id}`,
    }));
  const majorRows = [...majorFromProcurement, ...majorFromPayables, ...majorFromIc]
    .sort((a, b) => b.amountKobo - a.amountKobo)
    .slice(0, 20);

  const subsidiaries = entities.filter((entity) => entity.type === 'SUBSIDIARY');

  return (
    <>
      <PageHeader
        eyebrow="Corporate"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Group briefing — final approvals, major transactions, and consolidated position."
      />
      <PendingActionsPanel />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <HomeKpiCard label="Pending my final approval" value={myApprovals.length} href="/workflows" />
        <HomeKpiCard
          label="Major transactions"
          value={majorRows.length}
          href="/home/md"
          hint={`≥ ${formatKobo(BigInt(MAJOR_TRANSACTION_THRESHOLD_KOBO))}`}
        />
        <HomeKpiCard
          label="Group cash position"
          value={formatKobo(BigInt(consolidated?.cashPositionKobo ?? 0))}
          href="/finance?scope=consolidated"
        />
        <HomeKpiCard
          label="Group budget utilization"
          value={utilizationPct === null ? '—' : `${utilizationPct}%`}
          href="/finance/budgets"
          hint={
            consolidated
              ? formatKobo(BigInt(consolidated.budgetUtilizationKobo))
              : undefined
          }
        />
        <HomeKpiCard
          label="Overdue workflows"
          value={overdue.length}
          href="/workflows/overdue"
          danger={overdue.length > 0}
          hint="Group-wide"
        />
        {orgDash ? (
          <HomeKpiCard label="Incoming official reports" value={orgDash.incoming} href="/org-reports/incoming" />
        ) : null}
      </div>

      <Surface padded={false} className="mb-4">
        <SurfaceHeader title="Group procurement status" description="Counts across subsidiaries in your scope." />
        <HomeStatusTiles
          basePath="/procurement"
          tiles={PROCUREMENT_HOME_TILE_STATUSES.map((status) => ({
            key: status,
            label: PROCUREMENT_TILE_LABELS[status],
            count: list.counts[status] ?? 0,
          }))}
        />
      </Surface>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="My pending approvals" description="Requisitions at your final stage." />
            <HomeQueueTable
              rows={myApprovals.map((row) => ({
                id: row.id,
                reference: row.referenceNumber,
                title: row.title,
                meta: [row.entityCode, row.currentStageLabel, `${row.daysPending}d`]
                  .filter(Boolean)
                  .join(' · '),
                amountKobo: row.amountKobo,
                href: row.href ?? `/procurement/${row.subjectId}`,
              }))}
              emptyTitle="Nothing awaiting final approval"
              emptyDescription="Procurement that reaches the MD stage will appear here."
            />
          </Surface>

          {me.permissions.includes('hr.disciplinary.approve') ? (
            <Surface padded={false}>
              <SurfaceHeader
                title="Disciplinary awaiting decision"
                description="Suspension or more serious outcomes only. Written warnings stay with HR."
              />
              <HomeQueueTable
                rows={awaitingMd.map((row) => ({
                  id: row.id,
                  reference: row.referenceNumber,
                  title: row.employeeName,
                  meta: [row.entityCode, row.outcome, row.category].filter(Boolean).join(' · '),
                  href: `/workflows/pending`,
                }))}
                emptyTitle="No disciplinary cases at MD"
                emptyDescription="HR sends suspension and above here after recommendation."
              />
            </Surface>
          ) : null}

          <Surface padded={false}>
            <SurfaceHeader
              title="Major transactions"
              description={`Amounts at or above ${formatKobo(BigInt(MAJOR_TRANSACTION_THRESHOLD_KOBO))}.`}
            />
            <HomeQueueTable
              rows={majorRows}
              emptyTitle="No major transactions in view"
              emptyDescription="Large procurement, payables and intercompany rows surface here."
            />
          </Surface>
        </div>

        <div className="space-y-4">
          <Surface padded={false}>
            <SurfaceHeader title="Subsidiaries" description="Open finance scoped to each operating company." />
            <ul className="divide-y divide-ink-100">
              {subsidiaries.length === 0 ? (
                <li className="px-4 py-3 text-[13px] text-ink-500">No subsidiaries visible.</li>
              ) : (
                subsidiaries.map((entity) => (
                  <li key={entity.id} className="px-4 py-3 text-[13px]">
                    <Link href={`/finance?scope=${entity.code}`} className="font-medium underline">
                      {entity.code}
                    </Link>
                    <span className="text-ink-700"> — {entity.name}</span>
                    <p className="mt-0.5 text-[12px] text-ink-500">
                      <Link href={`/procurement?entity=${entity.code}`} className="underline">
                        Procurement
                      </Link>
                    </p>
                  </li>
                ))
              )}
            </ul>
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader title="Finance snapshot" description="Consolidated tiles — full board on Finance." />
            {consolidated ? (
              <dl className="divide-y divide-ink-100 text-[13px]">
                <div className="flex justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-500">Cash</dt>
                  <dd className="tabular font-medium">{formatKobo(BigInt(consolidated.cashPositionKobo))}</dd>
                </div>
                <div className="flex justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-500">Receivables</dt>
                  <dd className="tabular font-medium">
                    {formatKobo(BigInt(consolidated.outstandingReceivablesKobo))}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-500">Payables</dt>
                  <dd className="tabular font-medium">
                    {formatKobo(BigInt(consolidated.outstandingPayablesKobo))}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 px-4 py-2">
                  <dt className="text-ink-500">P&amp;L</dt>
                  <dd className="tabular font-medium">{formatKobo(BigInt(consolidated.profitLossKobo))}</dd>
                </div>
                <div className="px-4 py-2">
                  <Link href="/finance?scope=consolidated" className="underline">
                    Open finance
                  </Link>
                </div>
              </dl>
            ) : (
              <p className="px-4 py-3 text-[13px] text-ink-500">Finance dashboard unavailable.</p>
            )}
          </Surface>

          {me.permissions.includes('inventory.view') ? (
            <InventorySnapshot
              onHandValueKobo={kpis.onHandValueKobo}
              expectedLines={kpis.expectedLines}
              lowStockCount={kpis.lowStockCount}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
