import Link from 'next/link';
import type { HomeSummaryView, MeView } from '@nfc/shared';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { PendingActionsPanel } from '@/components/home/PendingActionsPanel';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Corporate home — NFC' };

export default async function CorporateHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  const summary = await apiFetch<HomeSummaryView>('/api/home/summary');

  return (
    <>
      <PageHeader
        eyebrow="Corporate"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="Group summary — pending actions across modules you may access, and subsidiary entry points."
      />
      <PendingActionsPanel />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HomeKpiCard
          label="Pending actions"
          value={summary.pendingTotal}
          href={summary.pendingLines[0]?.href}
          danger={summary.pendingTotal > 0}
        />
        <HomeKpiCard
          label="My role dashboard"
          value="Open"
          href={summary.roleDashboardPath}
          hint="Queues and tiles for your role"
        />
        {summary.adminOps ? (
          <HomeKpiCard
            label="Platform failures"
            value={
              summary.adminOps.deadLetterCount +
              summary.adminOps.failedNotificationDeliveries +
              summary.adminOps.failedMail
            }
            href="/admin/health"
            danger
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Surface padded={false} className="lg:col-span-2">
          <SurfaceHeader title="Pending actions" description="Only non-zero counts for modules you may access." />
          {summary.pendingLines.length === 0 ? (
            <EmptyState
              title="Nothing waiting on you"
              description="Module queues with work will appear here with a direct link."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {summary.pendingLines.map((line) => (
                <li key={line.key} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <Link href={line.href} className="font-medium underline">
                    {line.label}
                  </Link>
                  <span className="tabular font-semibold text-ink-900">{line.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <Surface padded={false}>
          <SurfaceHeader title="Subsidiaries" description="Entity-scoped finance, inventory and procurement." />
          {summary.subsidiaries.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-500">No operating companies in your scope.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {summary.subsidiaries.map((entity) => (
                <li key={entity.id} className="px-4 py-3 text-[13px]">
                  <p className="font-medium text-ink-900">
                    {entity.code} — {entity.name}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                    <Link href={entity.financeHref} className="underline">
                      Finance
                    </Link>
                    <Link href={entity.inventoryHref} className="underline">
                      Inventory
                    </Link>
                    <Link href={entity.procurementHref} className="underline">
                      Procurement
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </div>
    </>
  );
}
