import type { InventoryContextView, StockMovementView } from '@nfc/shared';
import { formatKobo, STOCK_MOVEMENT_SOURCES } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Movement ledger — Inventory — NFC' };

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; source?: string; from?: string; to?: string; q?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const scope = inventoryScopeParam(resolved);
  const canRead = resolved.consolidated || Boolean(resolved.entityId);
  const source = STOCK_MOVEMENT_SOURCES.includes(query.source as (typeof STOCK_MOVEMENT_SOURCES)[number])
    ? query.source
    : undefined;
  const rows = canRead
    ? await apiFetch<StockMovementView[]>('/api/inventory/movements', {
        query: inventoryApiQuery(resolved, {
          source,
          from: query.from,
          to: query.to,
          q: query.q,
        }),
      })
    : [];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Movement ledger"
        description="Append-only stock movements. Receipts, issues, transfers, production, sales and adjustments share this register."
      />
      <Surface className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          {scope ? <input type="hidden" name="scope" value={scope} /> : null}
          <label className="text-[13px]">
            <span className="font-semibold text-ink-700">Search</span>
            <input
              name="q"
              defaultValue={query.q ?? ''}
              className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
            />
          </label>
          <label className="text-[13px]">
            <span className="font-semibold text-ink-700">Source</span>
            <select
              name="source"
              defaultValue={source ?? ''}
              className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
            >
              <option value="">All</option>
              {STOCK_MOVEMENT_SOURCES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="font-semibold text-ink-700">From</span>
            <input
              type="date"
              name="from"
              defaultValue={query.from ?? ''}
              className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
            />
          </label>
          <label className="text-[13px]">
            <span className="font-semibold text-ink-700">To</span>
            <input
              type="date"
              name="to"
              defaultValue={query.to ?? ''}
              className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className="border border-ink-300 px-3 py-1.5 text-[13px]">
              Filter
            </button>
          </div>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No movements" description="Posted receipts, issues and transfers appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Movement</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={withInvScope(`/inventory/items/${row.itemId}`, row.entityCode ?? scope)}
                      className="underline"
                    >
                      {row.itemCode}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="tabular px-4 py-2">{row.quantityIn || -row.quantityOut}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.valueKobo))}</td>
                  <td className="px-4 py-2">{row.source}</td>
                  <td className="px-4 py-2">{row.occurredOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
