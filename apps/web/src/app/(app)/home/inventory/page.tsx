import Link from 'next/link';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { InventorySnapshot } from '@/components/home/InventorySnapshot';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { loadOfficerQueues, toQueueRow } from './officer-queues';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — Procurement Manager — NFC' };

export default async function InventoryOfficerHomePage() {
  const { me, pending, shortages, prepare, pendingCount, shortageCount, completedCount, prepareCount } =
    await loadOfficerQueues();
  const kpis = await apiFetch<{
    onHandValueKobo: number;
    expectedLines: number;
    lowStockCount: number;
    openProductionOrders: number;
    reservedSalesLines: number;
  }>('/api/inventory/kpis').catch(() => ({
    onHandValueKobo: 0,
    expectedLines: 0,
    lowStockCount: 0,
    openProductionOrders: 0,
    reservedSalesLines: 0,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Corporate"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Prepare need-approved proposals, upload vendor invoices at ED Finance, then verify each delivered item."
      />
      <PendingActionsPanel />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HomeKpiCard
          label="Need approved — prepare"
          value={prepareCount}
          href="/procurement?status=AWAITING_PREPARATION"
          danger={prepareCount > 0}
        />
        <HomeKpiCard label="Pending" value={pendingCount} href="/home/inventory/pending" />
        <HomeKpiCard
          label="Partially received"
          value={shortageCount}
          href="/home/inventory/shortages"
          danger={shortageCount > 0}
        />
        <HomeKpiCard label="Completed" value={completedCount} href="/home/inventory/history" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader
              title="Need approved — prepare proposal"
              description="MD has approved the need. Add the vendor quotations, prices and the selected vendor."
            />
            <HomeQueueTable
              rows={prepare.slice(0, 20).map((item) => toQueueRow(item))}
              emptyTitle="Nothing to prepare"
              emptyDescription="Need-approved requisitions appear here for pricing."
            />
            <p className="border-t border-ink-100 px-4 py-2 text-[12px] text-ink-500">
              <Link href="/procurement?status=AWAITING_PREPARATION" className="underline">
                View all to prepare
              </Link>
            </p>
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader
              title="Pending deliveries"
              description="Requests waiting for a goods received note."
            />
            <HomeQueueTable
              rows={pending.slice(0, 20).map((item) => toQueueRow(item))}
              emptyTitle="Nothing awaiting delivery"
              emptyDescription="Requests move here when delivery is due."
            />
            <p className="border-t border-ink-100 px-4 py-2 text-[12px] text-ink-500">
              <Link href="/home/inventory/pending" className="underline">
                View all pending
              </Link>
            </p>
          </Surface>

          <Surface padded={false}>
            <SurfaceHeader
              title="Shortage tracker"
              description="Partial receipts with remainder. Overdue second-batch dates are flagged."
            />
            <HomeQueueTable
              rows={shortages.slice(0, 20).map((item) => toQueueRow(item, { outstanding: true }))}
              columns={['reference', 'meta', 'detail', 'amount']}
              emptyTitle="No partial deliveries"
              emptyDescription="Partial receipts with remainder appear here."
            />
            <p className="border-t border-ink-100 px-4 py-2 text-[12px] text-ink-500">
              <Link href="/home/inventory/shortages" className="underline">
                View all shortages
              </Link>
            </p>
          </Surface>
        </div>
        <div className="space-y-4">
          <InventorySnapshot
            onHandValueKobo={kpis.onHandValueKobo}
            expectedLines={kpis.expectedLines}
            lowStockCount={kpis.lowStockCount}
            openProductionOrders={kpis.openProductionOrders}
            reservedSalesLines={kpis.reservedSalesLines}
          />
        </div>
      </div>
    </>
  );
}
