import type { InventoryContextView, MeView, StockBatchListView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { updateBatchAction } from '../desk-actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Batches — Inventory — NFC' };

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<InventoryContextView>('/api/inventory/context'),
  ]);
  const resolved = resolveInventoryScope(context, query.scope);
  const rows =
    resolved.consolidated || resolved.entityId
      ? await apiFetch<StockBatchListView[]>('/api/inventory/batches', { query: inventoryApiQuery(resolved) })
      : [];
  const canEdit = me.permissions.includes('inventory.item.manage');
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Batches"
        description="Batch and lot codes on hand, with manufacturing and expiry dates when known. Balances are the sum of stock movements for each batch."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No batches" description="Batches appear when batch-tracked stock is received." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Batch</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Manufactured</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                  <td className="px-4 py-2 font-medium">{row.batchCode}</td>
                  <td className="px-4 py-2">
                    {row.itemCode} — {row.itemName}
                  </td>
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="px-4 py-2">{row.manufacturedOn ?? '—'}</td>
                  <td className="px-4 py-2">{row.expiresOn ?? '—'}</td>
                  <td className="px-4 py-2">
                    {row.expiryStatus === 'expired'
                      ? 'Expired'
                      : row.expiryStatus === 'near'
                        ? 'Near expiry'
                        : row.expiryStatus === 'undated'
                          ? 'No date'
                          : 'Valid'}
                  </td>
                  <td className="tabular px-4 py-2 text-right">{row.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {canEdit && rows.length > 0 ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Update batch dates" description="Expiry cannot be earlier than manufacturing." />
          <InventoryForm
            action={updateBatchAction}
            submitLabel="Save dates"
            fields={[
              {
                name: 'id',
                label: 'Batch',
                required: true,
                options: rows.map((row) => ({
                  value: row.id,
                  label: `${row.batchCode} · ${row.itemCode} · ${row.warehouseName}`,
                })),
              },
              { name: 'manufacturedOn', label: 'Manufacturing date', type: 'date' },
              { name: 'expiresOn', label: 'Expiry date', type: 'date' },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
