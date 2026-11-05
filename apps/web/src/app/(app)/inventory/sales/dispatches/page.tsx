import type { InventoryContextView, SalesDispatchView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatches — Inventory — NFC' };

export default async function DispatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const rows =
    resolved.consolidated || resolved.entityId
      ? await apiFetch<SalesDispatchView[]>('/api/inventory/sales/dispatches', {
          query: inventoryApiQuery(resolved),
        })
      : [];
  return (
    <>
      <PageHeader eyebrow="Inventory" title="Dispatches" description="Outbound deliveries against sales orders." />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No dispatches" description="Dispatched sales appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Sales order</th>
                <th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={withInvScope(`/inventory/sales/${row.salesOrderId}`, inventoryScopeParam(resolved))}
                      className="underline"
                    >
                      {row.salesOrderReference}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.destination}</td>
                  <td className="px-4 py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
