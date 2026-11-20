import Link from 'next/link';
import type { DeskTile, InventoryContextView, InventorySettingView, QuarantineLineView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operations Desk — Inventory — NFC' };

const TILE_COPY: Record<DeskTile, { label: string; description: string; href: string; lane: 'A' | 'B' | 'QC' }> = {
  issue: {
    label: 'Issue',
    description: 'Issue available stock to a department, project or production.',
    href: '/inventory/issues',
    lane: 'A',
  },
  transfer: {
    label: 'Transfer',
    description: 'Move stock between stores in this subsidiary (STR-).',
    href: '/inventory/transfers',
    lane: 'A',
  },
  dispatch: {
    label: 'Sell / dispatch',
    description: 'Dispatch approved sales orders.',
    href: '/inventory/sales/dispatches',
    lane: 'A',
  },
  production_issue: {
    label: 'Production',
    description: 'Issue materials to planned orders and record output.',
    href: '/inventory/production',
    lane: 'A',
  },
  receive_return: {
    label: 'Receive return',
    description: 'Take back stock from a department. It lands in quarantine.',
    href: '/inventory/returns?kind=RECEIVE_RETURN',
    lane: 'A',
  },
  return_supplier: {
    label: 'Return to supplier',
    description: 'Send rejected or quarantined stock back to the vendor.',
    href: '/inventory/returns?kind=SUPPLIER_RETURN',
    lane: 'A',
  },
  asset_move: {
    label: 'Assets',
    description: 'Register, assign, move and photograph tracked assets.',
    href: '/inventory/assets',
    lane: 'A',
  },
  dispose: {
    label: 'Dispose / write-off',
    description: 'Prepare a disposal for ED Operations approval.',
    href: '/inventory/adjustments',
    lane: 'B',
  },
  adjust: {
    label: 'Stock adjustment',
    description: 'Adjust from a completed stock count only.',
    href: '/inventory/counts',
    lane: 'B',
  },
  qc: {
    label: 'QC release / reject',
    description: 'Release quarantined stock to available, or reject it. Reason required.',
    href: '/inventory/qc',
    lane: 'QC',
  },
};

const LANE_LABEL = { A: 'Posts immediately', B: 'Needs approval', QC: 'General Manager' } as const;

const MANAGEMENT_LINKS = [
  { href: '/inventory/items', label: 'Stock Register' },
  { href: '/inventory', label: 'Balances' },
  { href: '/inventory/warehouses', label: 'Warehouses & locations' },
  { href: '/inventory/batches', label: 'Batches' },
  { href: '/inventory/receipts', label: 'Goods received' },
  { href: '/inventory/movements', label: 'Stock ledger' },
  { href: '/inventory/counts', label: 'Counts' },
  { href: '/inventory/reports', label: 'Reports' },
];

export default async function OperationsDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const [desk, settings, quarantine] = await Promise.all([
    apiFetch<{ tiles: DeskTile[] }>('/api/inventory/desk'),
    apiFetch<InventorySettingView[]>('/api/inventory/settings').catch(() => [] as InventorySettingView[]),
    resolved.consolidated || resolved.entityId
      ? apiFetch<QuarantineLineView[]>('/api/inventory/qc', { query: inventoryApiQuery(resolved) }).catch(
          () => [] as QuarantineLineView[],
        )
      : Promise.resolve([] as QuarantineLineView[]),
  ]);
  const scopeSuffix = query.scope ? `scope=${encodeURIComponent(query.scope)}` : '';
  const withScope = (href: string) =>
    scopeSuffix ? `${href}${href.includes('?') ? '&' : '?'}${scopeSuffix}` : href;
  const unconfirmed = settings.filter((row) => row.status !== 'CONFIRMED');

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Operations Desk"
        description={`Day-to-day stock transactions for ${resolved.label}. Every action needs a reason and is recorded in the inventory audit trail.`}
      />
      {unconfirmed.length > 0 ? (
        <div
          className="mb-4 border-l-2 border-warning-600 bg-warning-100 px-3 py-2 text-[13px] text-ink-800"
          data-testid="desk-settings-unconfirmed"
        >
          {unconfirmed.map((row) => row.description).join(' ')} Not yet confirmed. Workflows that depend on these
          values are blocked until they are confirmed.
        </div>
      ) : null}
      <Surface className="mb-4">
        <SurfaceHeader title="Look up" />
        <form action="/inventory/scan" method="get" className="flex flex-wrap items-end gap-2 px-4 py-3">
          {query.scope ? <input type="hidden" name="scope" value={query.scope} /> : null}
          <label className="min-w-[16rem] flex-1 text-[12px] text-ink-600">
            Item code, batch, AST- or serial
            <input
              name="code"
              type="search"
              className="mt-1 w-full border border-ink-300 bg-surface px-2 py-1.5 text-[14px] text-ink-900"
              placeholder="Scan or type a code"
              data-testid="desk-lookup"
            />
          </label>
          <button
            type="submit"
            className="border border-ink-800 bg-ink-900 px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Look up
          </button>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title="Transactions" />
        {desk.tiles.length === 0 ? (
          <EmptyState title="No desk actions" description="Your role does not post stock transactions." />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {desk.tiles.map((tile) => {
              const copy = TILE_COPY[tile];
              return (
                <Link
                  key={tile}
                  href={withScope(copy.href)}
                  className="block border border-ink-200 bg-surface px-4 py-3 hover:border-ink-400"
                  data-testid={`desk-tile-${tile}`}
                >
                  <span className="block text-[14px] font-semibold text-ink-900">
                    {copy.label}
                    {tile === 'qc' && quarantine.length > 0 ? ` (${quarantine.length})` : ''}
                  </span>
                  <span className="mt-1 block text-[12px] text-ink-600">{copy.description}</span>
                  <span className="mt-2 block text-[11px] uppercase tracking-wider text-ink-500">
                    {LANE_LABEL[copy.lane]}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Surface>
      <Surface className="mt-4">
        <SurfaceHeader title="Management" />
        <ul className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3 text-[13px]">
          {MANAGEMENT_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={withScope(link.href)} className="underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
