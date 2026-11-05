import type { ExpectedStockView, InventoryContextView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Expected stock — Inventory — NFC' };

export default async function ExpectedStockPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const rows =
    resolved.consolidated || resolved.entityId
      ? await apiFetch<ExpectedStockView[]>('/api/inventory/expected', { query: inventoryApiQuery(resolved) })
      : [];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Expected stock"
        description="Created when ED Finance approves a stock or asset request. This is not on hand."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="Nothing expected" description="Approved stock PRs appear here until they are received." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">PR</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Remaining</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={`/procurement/${row.procurementId}`} className="underline">
                      {row.procurementReference}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.itemName ?? row.itemCode ?? 'Unmapped'}</td>
                  <td className="px-4 py-2">{row.vendorName ?? '—'}</td>
                  <td className="tabular px-4 py-2">
                    {row.quantityRemaining} of {row.quantityExpected}
                  </td>
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
