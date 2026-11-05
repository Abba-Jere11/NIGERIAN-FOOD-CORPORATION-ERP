import type { InventoryContextView, StockMovementView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receipts — Inventory — NFC' };

export default async function InventoryReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const movements =
    resolved.consolidated || resolved.entityId
      ? await apiFetch<StockMovementView[]>('/api/inventory/movements', {
          query: inventoryApiQuery(resolved),
        })
      : [];
  const rows = movements.filter((row) => row.source === 'GRN' || row.source === 'REVERSE');
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Receipts"
        description="Accepted GRN quantities become stock. Record GRNs on the procurement request; warehouse is taken from the item default when omitted."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No receipts" description="Goods received notes for stock items appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Movement</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    <Link href={withInvScope(`/inventory/items/${row.itemId}`, row.entityCode ?? inventoryScopeParam(resolved))} className="underline">
                      {row.itemCode}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-2">{row.quantityIn || -row.quantityOut}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(row.valueKobo))}</td>
                  <td className="px-4 py-2">
                    {row.grnReference ?? row.source}
                    {row.procurementId ? (
                      <>
                        {' · '}
                        <Link href={`/procurement/${row.procurementId}`} className="underline">
                          {row.procurementReference}
                        </Link>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
