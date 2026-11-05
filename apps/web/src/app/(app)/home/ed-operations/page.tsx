import type {
  AuditEntryView,
  MeView,
  OverdueWorkflowView,
  ProcurementListView,
  WorkflowPendingView,
} from '@nfc/shared';
import { formatKobo, type Page } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { HomeQueueTable } from '@/components/home/HomeQueueTable';
import { InventorySnapshot } from '@/components/home/InventorySnapshot';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { ageBucket, ageLabel, isOnOrAfter, startOfUtcWeek } from '@/components/home/date-helpers';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { cx } from '@/lib/cx';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — ED Operations — NFC' };

const AGE_KEYS = ['0-2', '2-5', '5-7', '7+'] as const;

export default async function EdOperationsHomePage({
  searchParams,
}: {
  searchParams: Promise<{ age?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('procurement.approve.operations')) redirect('/forbidden');
  const query = await searchParams;
  const weekStart = startOfUtcWeek();

  const [pending, overdue, list, audit] = await Promise.all([
    apiFetch<WorkflowPendingView[]>('/api/workflows/pending').catch(() => [] as WorkflowPendingView[]),
    me.permissions.includes('oversight.overdue.view')
      ? apiFetch<OverdueWorkflowView[]>('/api/workflows/overdue').catch(() => [] as OverdueWorkflowView[])
      : Promise.resolve([] as OverdueWorkflowView[]),
    apiFetch<ProcurementListView>('/api/procurement').catch(() => ({ items: [], counts: {} }) as ProcurementListView),
    me.permissions.includes('audit.view')
      ? apiFetch<Page<AuditEntryView>>('/api/audit', { query: { page: 1, pageSize: 40 } }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const kpis = me.permissions.includes('inventory.view')
    ? await apiFetch<{ onHandValueKobo: number; expectedLines: number; lowStockCount: number }>(
        '/api/inventory/kpis',
      ).catch(() => ({ onHandValueKobo: 0, expectedLines: 0, lowStockCount: 0 }))
    : { onHandValueKobo: 0, expectedLines: 0, lowStockCount: 0 };

  const reviewQueue = pending.filter(
    (row) => row.subjectType === 'PROCUREMENT' || !row.subjectType,
  );
  const overdue7 = reviewQueue.filter((row) => row.daysPending >= 7).length;
  const approvedThisWeek = (audit?.rows ?? []).filter(
    (row) =>
      row.actorRef === me.ref &&
      row.action === 'approve' &&
      row.subjectType === 'procurement_request' &&
      isOnOrAfter(row.occurredAt, weekStart),
  ).length;
  const returnedRejectedThisWeek =
    list.items.filter(
      (item) =>
        (item.status === 'REJECTED' || (item.status === 'DRAFT' && item.currentVersion > 1)) &&
        isOnOrAfter(item.updatedAt, weekStart),
    ).length;

  const ageFilter = AGE_KEYS.includes(query.age as (typeof AGE_KEYS)[number])
    ? (query.age as (typeof AGE_KEYS)[number])
    : undefined;
  const filtered = reviewQueue.filter((row) => (ageFilter ? ageBucket(row.daysPending) === ageFilter : true));
  const ageingCounts = Object.fromEntries(
    AGE_KEYS.map((key) => [key, reviewQueue.filter((row) => ageBucket(row.daysPending) === key).length]),
  ) as Record<(typeof AGE_KEYS)[number], number>;

  const decisions = (audit?.rows ?? [])
    .filter(
      (row) =>
        row.actorRef === me.ref &&
        ['approve', 'return', 'reject'].includes(row.action) &&
        row.subjectType === 'procurement_request',
    )
    .slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Corporate"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Operational review queue across subsidiaries."
      />
      <PendingActionsPanel />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HomeKpiCard label="Awaiting my review" value={reviewQueue.length} href="/workflows" />
        <HomeKpiCard
          label="Overdue (7+ days)"
          value={overdue7}
          href="/workflows/overdue"
          danger={overdue7 > 0}
          hint={overdue.length ? `${overdue.length} group overdue holds` : undefined}
        />
        <HomeKpiCard label="Approved this week" value={approvedThisWeek} />
        <HomeKpiCard label="Returned / rejected this week" value={returnedRejectedThisWeek} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Pending review" description="Procurement waiting at Operations." />
            <div className="flex flex-wrap gap-2 border-b border-ink-100 px-4 py-3">
              {AGE_KEYS.map((key) => {
                const active = ageFilter === key;
                return (
                  <Link
                    key={key}
                    href={active ? '/home/ed-operations' : `/home/ed-operations?age=${key}`}
                    className={cx(
                      'border px-2 py-1 text-[12px]',
                      active ? 'border-accent-600 bg-accent-50 font-medium' : 'border-ink-200 hover:bg-ink-50',
                    )}
                  >
                    {key === '7+' ? '7+ days' : `${key} days`} · {ageingCounts[key]}
                  </Link>
                );
              })}
            </div>
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Reference</th>
                  <th className="px-4 py-2 font-semibold">Subsidiary</th>
                  <th className="px-4 py-2 font-semibold">Amount</th>
                  <th className="px-4 py-2 font-semibold">Days</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-ink-500">
                      Nothing in this ageing band.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="border-b border-ink-100">
                      <td className="px-4 py-2">
                        <Link href={row.href ?? `/procurement/${row.subjectId}`} className="underline">
                          {row.referenceNumber}
                        </Link>
                        <span className="block text-ink-600">{row.title}</span>
                      </td>
                      <td className="px-4 py-2">{row.entityCode ?? '—'}</td>
                      <td className="tabular px-4 py-2">
                        {row.amountKobo === null ? '—' : formatKobo(BigInt(row.amountKobo))}
                      </td>
                      <td className="px-4 py-2">{ageLabel(row.daysPending)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Surface>
        </div>

        <div className="space-y-4">
          <Surface padded={false}>
            <SurfaceHeader title="My recent decisions" description="Approvals, returns and rejections you recorded." />
            <HomeQueueTable
              rows={decisions.map((row) => ({
                id: row.id,
                reference: row.subjectReferenceNumber ?? row.subjectLabel ?? row.action,
                title: row.action,
                meta: row.occurredAt.slice(0, 10),
                detail: row.reason,
                href: row.subjectId ? `/procurement/${row.subjectId}` : '/workflows',
                amountKobo: null,
              }))}
              columns={['reference', 'meta', 'detail']}
              emptyTitle="No recent decisions"
              emptyDescription="Your approvals will appear here."
            />
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
