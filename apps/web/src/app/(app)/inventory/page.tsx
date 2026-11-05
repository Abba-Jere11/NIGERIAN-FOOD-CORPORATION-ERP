import type {
  InventoryContextView,
  InventoryOverviewView,
  MeView,
} from '@nfc/shared';
import { formatKobo, hasInventoryNavPermission, inventoryStockStatus } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from './scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inventory — NFC' };

export default async function InventoryOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const me = await apiFetch<MeView>('/api/me');
  if (!hasInventoryNavPermission(me.permissions)) redirect('/forbidden');
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const canRead = resolved.consolidated || Boolean(resolved.entityId);
  if (!canRead) {
    return (
      <>
        <PageHeader eyebrow="Inventory" title="Dashboard" description="No subsidiary is in scope." />
        <Surface>
          <EmptyState title="No entity" description="Inventory is held per subsidiary." />
        </Surface>
      </>
    );
  }
  const overview = await apiFetch<InventoryOverviewView>('/api/inventory', {
    query: inventoryApiQuery(resolved),
  });
  const scope = inventoryScopeParam(resolved);
  const title = resolved.consolidated ? 'Consolidated inventory' : `${resolved.label} stock`;
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title={title}
        description={
          resolved.consolidated
            ? 'Group on-hand value and item types from live movements. Quantities stay in their own units. As at today. Goods in transit are listed separately and are not added back to on-hand.'
            : `On-hand is the sum of movements for ${resolved.label}. Expected deliveries are not stock. As at today.`
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Kpi label="Item types" value={String(overview.itemCount)} />
        <Kpi label="On-hand value" value={formatKobo(BigInt(overview.onHandValueKobo))} />
        <Kpi
          label="Low stock"
          value={String(overview.lowStockCount)}
          href={withInvScope('/inventory/alerts', scope)}
        />
        <Kpi
          label="Out of stock"
          value={String(overview.outOfStockCount)}
          href={withInvScope('/inventory/alerts', scope)}
        />
        <Kpi
          label="Pending receipts"
          value={String(overview.expectedLines)}
          href={withInvScope('/inventory/expected', scope)}
        />
        <Kpi
          label="Reserved for sales"
          value={String(overview.reservedSalesLines)}
          href={withInvScope('/inventory/sales', scope)}
        />
        <Kpi
          label="In transit"
          value={`${overview.inTransitCount} · ${formatKobo(BigInt(overview.inTransitValueKobo))}`}
          href={withInvScope('/inventory/transfers', scope)}
        />
        <Kpi
          label="Pending adjustments"
          value={String(overview.pendingAdjustments)}
          href={withInvScope('/inventory/adjustments', scope)}
        />
        <Kpi
          label="Open production"
          value={String(overview.openProductionOrders)}
          href={withInvScope('/inventory/production', scope)}
        />
      </div>

      {!resolved.consolidated && resolved.entityId ? (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <span className="text-[11px] uppercase tracking-wider text-ink-500">Quick actions</span>
          {me.permissions.includes('inventory.item.manage') ? (
            <Link href={withInvScope('/inventory/items/new', scope)} className="underline">
              Add item
            </Link>
          ) : null}
          <Link href={withInvScope('/inventory/expected', scope)} className="underline">
            Expected stock
          </Link>
          {me.permissions.includes('procurement.verify.delivery') ? (
            <Link href="/home/inventory/pending" className="underline">
              Verify delivery
            </Link>
          ) : null}
          <Link href={withInvScope('/inventory/issues', scope)} className="underline">
            Issue stock
          </Link>
          <Link href={withInvScope('/inventory/transfers', scope)} className="underline">
            Transfer stock
          </Link>
          <Link href={withInvScope('/inventory/counts', scope)} className="underline">
            Start stocktaking
          </Link>
          <Link href={withInvScope('/inventory/production', scope)} className="underline">
            Production
          </Link>
          <Link href={withInvScope('/inventory/sales', scope)} className="underline">
            Sales
          </Link>
        </div>
      ) : (
        <p className="mb-4 text-[13px] text-ink-600">
          Select a subsidiary to add items, issue stock, or start production.{' '}
          <Link href={withInvScope('/inventory/items', scope)} className="underline">
            Open stock register
          </Link>
        </p>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="By category" description="On-hand value. Quantities are not summed across units." />
          {overview.byCategory.length === 0 ? (
            <EmptyState title="No categories" description="Receive stock or create an item." />
          ) : (
            <DistributionTable rows={overview.byCategory} />
          )}
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="By warehouse" description="On-hand value at each location." />
          {overview.byWarehouse.length === 0 ? (
            <EmptyState title="No warehouses" description="Add a store or cold room." />
          ) : (
            <DistributionTable rows={overview.byWarehouse} />
          )}
        </Surface>
      </div>

      {resolved.consolidated ? (
        <Surface padded={false} className="mb-4">
          <SurfaceHeader title="By subsidiary" description="Each row opens that subsidiary's inventory." />
          {overview.byEntity.length === 0 ? (
            <EmptyState title="No stock" description="No items in accessible subsidiaries." />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2">Item types</th>
                  <th className="px-4 py-2">On-hand value</th>
                  <th className="px-4 py-2">Low stock</th>
                </tr>
              </thead>
              <tbody>
                {overview.byEntity.map((row) => (
                  <tr key={row.key} className="border-b border-ink-100">
                    <td className="px-4 py-2">
                      <Link href={withInvScope('/inventory', row.label)} className="underline">
                        {row.label}
                      </Link>
                    </td>
                    <td className="tabular px-4 py-2">{row.itemCount}</td>
                    <td className="tabular px-4 py-2">{formatKobo(BigInt(row.onHandValueKobo))}</td>
                    <td className="tabular px-4 py-2">{row.lowStockCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="Attention" description={`${overview.pendingAdjustments} adjustment(s) awaiting approval.`} />
          {overview.attention.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="Low stock, overdue receipts, write-offs and in-transit transfers appear here." />
          ) : (
            <ul className="divide-y divide-ink-100 text-[13px]">
              {overview.attention.map((item) => (
                <li key={`${item.kind}-${item.href}-${item.label}`} className="px-4 py-2">
                  <Link href={withInvScope(item.href, scope)} className="underline">
                    {item.label}
                  </Link>
                  <p className="text-[12px] text-ink-500">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader
            title="Recent movements"
            actions={
              <Link href={withInvScope('/inventory/movements', scope)} className="underline">
                Movement ledger
              </Link>
            }
          />
          {overview.recentMovements.length === 0 ? (
            <EmptyState title="No movements" description="Receipts, issues and transfers appear here." />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2">Movement</th>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentMovements.map((row) => (
                  <tr key={row.id} className="border-b border-ink-100">
                    <td className="px-4 py-2">{row.referenceNumber}</td>
                    <td className="px-4 py-2">
                      <Link href={withInvScope(`/inventory/items/${row.itemId}`, row.entityCode ?? scope)} className="underline">
                        {row.itemCode}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      </div>

      <Surface padded={false}>
        <SurfaceHeader
          title="On hand"
          actions={
            <Link href={withInvScope('/inventory/items', scope)} className="underline">
              Open stock register
            </Link>
          }
        />
        {overview.rows.length === 0 ? (
          <EmptyState title="No items" description="Create an item or receive a goods note." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">On hand</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.rows.map((row) => {
                const status = inventoryStockStatus(row);
                return (
                  <tr key={row.id} className="border-b border-ink-100">
                    {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                    <td className="px-4 py-2">
                      <Link href={withInvScope(`/inventory/items/${row.id}`, row.entityCode ?? scope)} className="underline">
                        {row.code}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{row.name}</td>
                    <td className="px-4 py-2">{row.categoryName}</td>
                    <td className="tabular px-4 py-2">
                      {row.onHandQty} {row.uomCode}
                    </td>
                    <td className="tabular px-4 py-2">{formatKobo(BigInt(row.onHandValueKobo))}</td>
                    <td className="px-4 py-2">
                      {status === 'out' ? 'Out of stock' : status === 'low' ? 'Low stock' : 'In stock'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}

function Kpi({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className="border border-ink-200 bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className="text-lg font-semibold text-ink-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function DistributionTable({
  rows,
}: {
  rows: Array<{ key: string; label: string; itemCount: number; onHandValueKobo: number }>;
}) {
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
        <tr>
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Items</th>
          <th className="px-4 py-2">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-ink-100">
            <td className="px-4 py-2">{row.label}</td>
            <td className="tabular px-4 py-2">{row.itemCount}</td>
            <td className="tabular px-4 py-2">{formatKobo(BigInt(row.onHandValueKobo))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
