import type {
  InventoryContextView,
  MeView,
  StockTransferView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { SmartStockForm } from '../_components/DeskWidgets';
import { transferAction } from '../actions';
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
  const [rows, warehouses] =
    resolved.consolidated || resolved.entityId
      ? await Promise.all([
          apiFetch<StockTransferView[]>('/api/inventory/transfers', { query: inventoryApiQuery(resolved) }),
          resolved.entityId
            ? apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } })
            : Promise.resolve([] as WarehouseView[]),
        ])
      : [[], []];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Transfers"
        description="Move stock between stores in the same subsidiary. It posts immediately (STR-). Transfers between subsidiaries are disabled in this phase; earlier ones remain visible below."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No transfers" description="Store-to-store transfers appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">To</th>
                <th className="px-4 py-2">Status</th>
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
                  <td className="px-4 py-2">
                    {row.status.replaceAll('_', ' ')}
                    {row.sourceEntityId !== row.destinationEntityId ? ' · earlier inter-subsidiary transfer (read-only)' : ''}
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
          <SmartStockForm
            action={transferAction}
            entityId={resolved.entityId}
            warehouses={warehouses}
            warehouseFieldName="sourceWarehouseId"
            warehouseLabel="From store"
            submitLabel="Confirm Transfer"
            reviewKind="transfer"
            hidden={<input type="hidden" name="destinationEntityId" value={resolved.entityId} />}
            extraFields={
              <>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">To store</span>
                  <select name="destWarehouseId" required className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5">
                    <option value="">Select a warehouse</option>
                    {warehouses.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Notes</span>
                  <input name="reason" required className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Date</span>
                  <input name="occurredOn" type="date" required defaultValue={today} className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
              </>
            }
          />
        </Surface>
      ) : null}
    </>
  );
}
