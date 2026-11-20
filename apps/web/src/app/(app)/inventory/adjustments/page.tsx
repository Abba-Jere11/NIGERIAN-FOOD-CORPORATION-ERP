import Link from 'next/link';
import type {
  InventoryContextView,
  InventoryItemListView,
  MeView,
  StockAdjustmentView,
  WarehouseView,
} from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { disposalAction } from '../desk-actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Adjustments and disposals — Inventory — NFC' };

export default async function InventoryAdjustmentsPage({
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
  const [rows, items, warehouses] =
    resolved.consolidated || resolved.entityId
      ? await Promise.all([
          apiFetch<StockAdjustmentView[]>('/api/inventory/adjustments', { query: inventoryApiQuery(resolved) }),
          resolved.entityId
            ? apiFetch<InventoryItemListView[]>('/api/inventory/items', { query: { entityId: resolved.entityId } })
            : Promise.resolve([] as InventoryItemListView[]),
          resolved.entityId
            ? apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } })
            : Promise.resolve([] as WarehouseView[]),
        ])
      : [[], [], []];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Adjustments and disposals"
        description="The Procurement Manager prepares; ED Operations approves, and ED Finance as well when the value reaches the Lane B threshold. Stock adjustments come only from a completed count. Disposals need evidence. The preparer cannot approve."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Queue" />
        {rows.length === 0 ? (
          <EmptyState title="No adjustments" description="Prepared disposals and count adjustments appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    {row.kind.replaceAll('_', ' ')}
                    {row.countReference ? ` · from ${row.countReference}` : ''}
                    {row.assetId ? (
                      <>
                        {' · '}
                        <Link href={`/inventory/assets/${row.assetId}`} className="underline">
                          asset
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    {row.lines.map((line) => `${line.itemCode} ${line.quantity > 0 ? '+' : ''}${line.quantity}`).join(', ')}
                  </td>
                  <td className="px-4 py-2 tabular">
                    {row.valueKobo == null ? '—' : formatKobo(BigInt(row.valueKobo))}
                    {row.requiresFinance ? ' · ED Finance' : ''}
                  </td>
                  <td className="px-4 py-2">{row.reason}</td>
                  <td className="px-4 py-2">{row.status.replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.adjust.prepare') ? (
        <p className="mt-4 text-[13px] text-ink-700">
          To adjust quantities, complete a{' '}
          <Link href="/inventory/counts" className="underline">
            stock count
          </Link>{' '}
          and prepare the adjustment from its variances.
        </p>
      ) : null}
      {me.permissions.includes('inventory.dispose.request') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Prepare a disposal or write-off" />
          <InventoryForm
            action={disposalAction}
            entityId={resolved.entityId}
            submitLabel="Send for approval"
            fields={[
              {
                name: 'warehouseId',
                label: 'Warehouse',
                required: true,
                options: warehouses.map((row) => ({ value: row.id, label: row.name })),
              },
              {
                name: 'itemId',
                label: 'Item',
                required: true,
                options: items.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
              },
              { name: 'quantity', label: 'Quantity to remove', type: 'number', required: true },
              {
                name: 'stockStatus',
                label: 'Removed from',
                required: true,
                options: [
                  { value: 'AVAILABLE', label: 'Available stock' },
                  { value: 'REJECTED', label: 'Rejected stock' },
                  { value: 'QUARANTINED', label: 'Quarantined stock' },
                ],
              },
              {
                name: 'kind',
                label: 'Kind',
                required: true,
                options: [
                  { value: 'disposal', label: 'Disposal' },
                  { value: 'damaged', label: 'Damaged write-off' },
                  { value: 'expired', label: 'Expired write-off' },
                ],
              },
              { name: 'batchCode', label: 'Batch (if tracked)' },
              { name: 'serialCode', label: 'Serial (if tracked)' },
              { name: 'reason', label: 'Reason', required: true },
              { name: 'evidence', label: 'Evidence (photo or report)', type: 'file', required: true },
              { name: 'occurredOn', label: 'Date', type: 'date', required: true, defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
