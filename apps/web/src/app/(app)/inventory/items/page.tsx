import type {
  InventoryCategoryView,
  InventoryContextView,
  InventoryItemListView,
  MeView,
} from '@nfc/shared';
import { formatKobo, inventoryStockStatus } from '@nfc/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Item catalogue — Inventory — NFC' };

function statusLabel(status: 'out' | 'low' | 'in_stock'): string {
  if (status === 'out') return 'Out of stock';
  if (status === 'low') return 'Low stock';
  return 'In stock';
}

export default async function InventoryItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; q?: string; categoryId?: string; stockStatus?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<InventoryContextView>('/api/inventory/context'),
  ]);
  const resolved = resolveInventoryScope(context, query.scope);
  const scope = inventoryScopeParam(resolved);
  const canRead = resolved.consolidated || Boolean(resolved.entityId);
  const stockStatus =
    query.stockStatus === 'low' || query.stockStatus === 'out' || query.stockStatus === 'in_stock'
      ? query.stockStatus
      : undefined;
  const [rows, categories] = canRead
    ? await Promise.all([
        apiFetch<InventoryItemListView[]>('/api/inventory/items', {
          query: inventoryApiQuery(resolved, {
            q: query.q,
            categoryId: query.categoryId,
            stockStatus,
          }),
        }),
        apiFetch<InventoryCategoryView[]>('/api/inventory/categories', {
          query: inventoryApiQuery(resolved),
        }),
      ])
    : [[], []];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Item catalogue"
        description="Master data per subsidiary. The same code at another subsidiary is a different item. Stock on hand is derived from movements."
        actions={
          me.permissions.includes('inventory.item.manage') && resolved.entityId ? (
            <ButtonLink href={withInvScope('/inventory/items/new', resolved.entityCode)} variant="primary">
              New item
            </ButtonLink>
          ) : null
        }
      />
      <Surface className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
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
            <span className="font-semibold text-ink-700">Category</span>
            <select
              name="categoryId"
              defaultValue={query.categoryId ?? ''}
              className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
            >
              <option value="">All</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {resolved.consolidated && category.entityCode
                    ? `${category.entityCode} · ${category.name}`
                    : category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="font-semibold text-ink-700">Stock status</span>
            <select
              name="stockStatus"
              defaultValue={stockStatus ?? ''}
              className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
            >
              <option value="">All</option>
              <option value="in_stock">In stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>
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
          <EmptyState title="No items" description="Create an item or receive stock from a GRN." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2">On hand</th>
                <th className="px-4 py-2">Reserved</th>
                <th className="px-4 py-2">Available</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                  <td className="px-4 py-2">
                    <Link href={withInvScope(`/inventory/items/${row.id}`, row.entityCode ?? scope)} className="underline">
                      {row.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.categoryName}</td>
                  <td className="px-4 py-2">{row.uomCode}</td>
                  <td className="tabular px-4 py-2">{row.onHandQty}</td>
                  <td className="tabular px-4 py-2">{row.reservedQty}</td>
                  <td className="tabular px-4 py-2">{row.availableQty}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.onHandValueKobo))}</td>
                  <td className="px-4 py-2">{statusLabel(inventoryStockStatus(row))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
