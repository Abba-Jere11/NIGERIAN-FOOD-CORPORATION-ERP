import type {
  InventoryContextView,
  InventoryItemListView,
  MeView,
  StockAdjustmentView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { adjustmentAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Adjustments — Inventory — NFC' };

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
        title="Adjustments"
        description="Officer prepares; GM or ED Operations approves. Write-offs need evidence. Preparer cannot approve."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Queue" />
        {rows.length === 0 ? (
          <EmptyState title="No adjustments" description="Prepared write-offs and count variances appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">{row.kind.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-2">{row.reason}</td>
                  <td className="px-4 py-2">{row.status.replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.adjust.prepare') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Prepare adjustment" />
          <InventoryForm
            action={adjustmentAction}
            entityId={resolved.entityId}
            submitLabel="Submit for approval"
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
              { name: 'quantity', label: 'Quantity (+ in / − out)', type: 'number', required: true },
              {
                name: 'kind',
                label: 'Kind',
                required: true,
                options: [
                  { value: 'increase', label: 'Increase' },
                  { value: 'decrease', label: 'Decrease' },
                  { value: 'damaged', label: 'Damaged write-off' },
                  { value: 'expired', label: 'Expired write-off' },
                  { value: 'count_variance', label: 'Count variance' },
                ],
              },
              { name: 'reason', label: 'Reason', required: true },
              { name: 'evidenceDocumentId', label: 'Evidence document id (write-off)' },
              { name: 'occurredOn', label: 'Date', type: 'date', required: true, defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
