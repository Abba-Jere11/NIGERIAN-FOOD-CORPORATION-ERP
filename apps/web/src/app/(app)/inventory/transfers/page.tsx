import type {
  InventoryContextView,
  InventoryItemListView,
  MeView,
  StockTransferView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { receiveTransferAction, transferAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Transfers — Inventory — NFC' };

export default async function InventoryTransfersPage({
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
          apiFetch<StockTransferView[]>('/api/inventory/transfers', { query: inventoryApiQuery(resolved) }),
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
        title="Transfers"
        description="Intra-entity moves immediately. Inter-entity transfers wait for ED Operations, then receipt into a warehouse."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No transfers" description="Warehouse and subsidiary transfers appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">To</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">
                    {row.sourceEntityCode} · {row.sourceWarehouseName}
                  </td>
                  <td className="px-4 py-2">
                    {row.destEntityCode}
                    {row.destWarehouseName ? ` · ${row.destWarehouseName}` : ''}
                  </td>
                  <td className="px-4 py-2">{row.status.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-2">
                    {row.status === 'IN_TRANSIT' &&
                    me.permissions.includes('inventory.receive') &&
                    row.destinationEntityId === resolved.entityId ? (
                      <InventoryForm
                        action={receiveTransferAction}
                        submitLabel="Receive"
                        fields={[
                          { name: 'id', label: 'Id', type: 'hidden', defaultValue: row.id },
                          {
                            name: 'destWarehouseId',
                            label: 'Warehouse',
                            required: true,
                            options: warehouses.map((wh) => ({ value: wh.id, label: wh.name })),
                          },
                        ]}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.transfer') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="New transfer" />
          <InventoryForm
            action={transferAction}
            entityId={resolved.entityId}
            submitLabel="Transfer"
            fields={[
              {
                name: 'sourceWarehouseId',
                label: 'From warehouse',
                required: true,
                options: warehouses.map((row) => ({ value: row.id, label: row.name })),
              },
              {
                name: 'destinationEntityId',
                label: 'To entity',
                required: true,
                options: context.entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
                defaultValue: resolved.entityId,
              },
              {
                name: 'destWarehouseId',
                label: 'To warehouse (intra-entity)',
                options: [{ value: '', label: '—' }, ...warehouses.map((row) => ({ value: row.id, label: row.name }))],
              },
              {
                name: 'itemId',
                label: 'Item',
                required: true,
                options: items.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
              },
              { name: 'quantity', label: 'Quantity', type: 'number', required: true },
              { name: 'batchCode', label: 'Batch (if tracked)' },
              { name: 'serialCode', label: 'Serial (if tracked)' },
              { name: 'reason', label: 'Reason', required: true },
              { name: 'occurredOn', label: 'Date', type: 'date', required: true, defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
