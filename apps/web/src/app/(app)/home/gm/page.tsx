import type {
  BudgetView,
  FinanceDashboardView,
  MeView,
  OrgReportDashboardView,
  ProcurementListView,
  RequisitionView,
} from '@nfc/shared';
import {
  PROCUREMENT_HOME_TILE_STATUSES,
  PROCUREMENT_TILE_LABELS,
  formatKobo,
} from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { HomeStatusTiles } from '@/components/home/HomeStatusTiles';
import { InventorySnapshot } from '@/components/home/InventorySnapshot';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { isOnOrAfter, startOfUtcMonth } from '@/components/home/date-helpers';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { BudgetProgressStrip } from '@/app/(app)/finance/_components/BudgetProgressStrip';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — GM — NFC' };

export default async function GmHomePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('requisition.create')) redirect('/forbidden');
  const query = await searchParams;
  const monthStart = startOfUtcMonth();

  const [list, requisitions, budgets, dashboard] = await Promise.all([
    apiFetch<ProcurementListView>('/api/procurement'),
    apiFetch<{ items: RequisitionView[] }>('/api/requisitions').catch(
      () => ({ items: [] }) as { items: RequisitionView[] },
    ),
    me.permissions.includes('finance.budget.view')
      ? apiFetch<BudgetView[]>('/api/finance/budgets').catch(() => [] as BudgetView[])
      : Promise.resolve([] as BudgetView[]),
    me.permissions.includes('finance.dashboard.entity') || me.permissions.includes('finance.view')
      ? apiFetch<FinanceDashboardView>('/api/finance/dashboard', {
          query: { entityId: me.entities[0]?.id },
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const orgDash = me.permissions.includes('org_report.create')
    ? await apiFetch<OrgReportDashboardView>('/api/org-reports/dashboard').catch(() => null)
    : null;
  const kpis = me.permissions.includes('inventory.view')
    ? await apiFetch<{ onHandValueKobo: number; expectedLines: number; lowStockCount: number }>(
        '/api/inventory/kpis',
      ).catch(() => ({ onHandValueKobo: 0, expectedLines: 0, lowStockCount: 0 }))
    : { onHandValueKobo: 0, expectedLines: 0, lowStockCount: 0 };

  const returned = requisitions.items.filter((item) => item.status === 'DRAFT' && item.currentVersion > 1);
  const awaitingDelivery =
    (list.counts.AWAITING_DELIVERY ?? 0) + (list.counts.PARTIALLY_RECEIVED ?? 0);
  const requestsThisMonth = list.items.filter((item) => isOnOrAfter(item.createdAt, monthStart)).length;
  const completedThisMonth = list.items.filter(
    (item) => item.status === 'COMPLETED' && isOnOrAfter(item.updatedAt, monthStart),
  ).length;
  const tiles = dashboard?.entities[0] ?? null;
  const availableKobo = tiles?.availableBudgetKobo ?? 0;
  const approvedLines = budgets.filter((row) => row.status === 'APPROVED').flatMap((row) => row.lines);

  const statusFilter = query.status;
  const recentRows = list.items
    .filter((item) => (statusFilter ? item.status === statusFilter : true))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      reference: item.referenceNumber,
      title: item.title,
      meta: [item.status.replaceAll('_', ' '), item.vendorName].filter(Boolean).join(' · '),
      amountKobo: item.totalAmountKobo,
      href: `/procurement/${item.id}`,
    }));

  return (
    <>
      <PageHeader
        eyebrow={me.entities[0]?.name ?? 'Subsidiary'}
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Your subsidiary requisition board. Returned needs stay at the top."
        actions={
          <ButtonLink href="/requisitions/new" variant="primary">
            New requisition
          </ButtonLink>
        }
      />
      <PendingActionsPanel />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <HomeKpiCard label="My requests this month" value={requestsThisMonth} href="/requisitions" />
        <HomeKpiCard
          label="Awaiting my action"
          value={returned.length}
          href="/home/gm"
          danger={returned.length > 0}
          hint="Returned for correction"
        />
        <HomeKpiCard label="Awaiting delivery" value={awaitingDelivery} href="/procurement?status=AWAITING_DELIVERY" />
        <HomeKpiCard label="Completed this month" value={completedThisMonth} href="/procurement?status=COMPLETED" />
        <HomeKpiCard
          label="Budget available"
          value={formatKobo(BigInt(availableKobo))}
          href="/finance/budgets"
          hint="Own subsidiary · read-only"
        />
        {orgDash ? (
          <HomeKpiCard
            label="Assigned official minutes"
            value={orgDash.assignedMinutes}
            href="/org-reports/minutes"
            danger={orgDash.assignedMinutes > 0}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Needs your attention" description="Returned for correction — fix and resubmit." />
            {returned.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-500">Nothing returned right now.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {returned.map((item) => (
                  <li key={item.id} className="px-4 py-3 text-[13px]">
                    <Link href={`/requisitions/${item.id}`} className="font-medium underline">
                      {item.referenceNumber}
                    </Link>
                    <span className="text-ink-600"> · {item.title}</span>
                    {item.lastReturnReason ? (
                      <p className="mt-1 text-ink-700">Reason: {item.lastReturnReason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader title="Status" description="Filter the recent requests table." />
            <HomeStatusTiles
              basePath="/home/gm"
              active={statusFilter}
              tiles={PROCUREMENT_HOME_TILE_STATUSES.map((status) => ({
                key: status,
                label: PROCUREMENT_TILE_LABELS[status],
                count: list.counts[status] ?? 0,
              }))}
            />
            {statusFilter ? (
              <p className="border-t border-ink-100 px-4 py-2 text-[12px] text-ink-500">
                Showing {PROCUREMENT_TILE_LABELS[statusFilter as keyof typeof PROCUREMENT_TILE_LABELS] ?? statusFilter}.{' '}
                <Link href="/home/gm" className="underline">
                  Clear filter
                </Link>
              </p>
            ) : null}
            <HomeQueueTable
              rows={recentRows}
              emptyTitle="No requests"
              emptyDescription="Create a requisition to populate this list."
            />
          </Surface>
        </div>

        <div className="space-y-4">
          <Surface padded={false}>
            <SurfaceHeader title="Budget snapshot" description="Approved, committed and available on live lines." />
            {approvedLines.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-500">No approved budget lines in view.</p>
            ) : (
              <BudgetProgressStrip lines={approvedLines} />
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
