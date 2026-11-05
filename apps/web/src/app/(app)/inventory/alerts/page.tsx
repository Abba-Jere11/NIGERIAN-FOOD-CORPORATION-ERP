import type { InventoryContextView, InventoryItemListView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Alerts — Inventory — NFC' };

export default async function InventoryAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const rows =
    resolved.consolidated || resolved.entityId
      ? await apiFetch<InventoryItemListView[]>('/api/inventory/alerts', { query: inventoryApiQuery(resolved) })
      : [];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Low-stock alerts"
        description="On-hand at or below reorder level. The officer is notified when a movement crosses the line."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No low-stock items" description="Items at or below reorder level appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">On hand</th>
                <th className="px-4 py-2">Reorder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={withInvScope(`/inventory/items/${row.id}`, row.entityCode ?? inventoryScopeParam(resolved))} className="underline">
                      {row.code} — {row.name}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-2">
                    {row.onHandQty} {row.uomCode}
                  </td>
                  <td className="tabular px-4 py-2">{row.reorderLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
