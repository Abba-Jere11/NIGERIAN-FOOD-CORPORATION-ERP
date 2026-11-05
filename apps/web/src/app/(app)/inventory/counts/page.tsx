import type { InventoryContextView, MeView, StockCountView, WarehouseView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { createCountAction, submitCountAction, updateCountLineAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stocktaking — Inventory — NFC' };

export default async function InventoryCountsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; open?: string }>;
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
          apiFetch<StockCountView[]>('/api/inventory/counts', { query: inventoryApiQuery(resolved) }),
          resolved.entityId
            ? apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } })
            : Promise.resolve([] as WarehouseView[]),
        ])
      : [[], []];
  const open = rows.find((row) => row.id === query.open) ?? rows.find((row) => row.status === 'OPEN');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Stocktaking"
        description="Blind counts hide system quantity. Submit creates a pending variance adjustment."
      />
      {me.permissions.includes('inventory.count') && resolved.entityId ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Start count" />
          <InventoryForm
            action={createCountAction}
            entityId={resolved.entityId}
            submitLabel="Start"
            fields={[
              { name: 'scope', label: 'Scope', type: 'hidden', defaultValue: resolved.entityCode },
              {
                name: 'warehouseId',
                label: 'Warehouse',
                required: true,
                options: warehouses.map((row) => ({ value: row.id, label: row.name })),
              },
              {
                name: 'mode',
                label: 'Mode',
                required: true,
                options: [
                  { value: 'guided', label: 'Guided' },
                  { value: 'blind', label: 'Blind' },
                ],
              },
              { name: 'countedOn', label: 'Date', type: 'date', required: true, defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No counts" description="Start a warehouse count to record physical stock." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Mode</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="px-4 py-2">{row.mode}</td>
                  <td className="px-4 py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {open && open.status === 'OPEN' ? (
        <Surface className="mt-4" padded={false}>
          <SurfaceHeader title={`${open.referenceNumber} lines`} />
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                {open.mode === 'guided' ? <th className="px-4 py-2">System</th> : null}
                <th className="px-4 py-2">Counted</th>
              </tr>
            </thead>
            <tbody>
              {open.lines.map((line) => (
                <tr key={line.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    {line.itemCode} — {line.itemName}
                  </td>
                  {open.mode === 'guided' ? <td className="tabular px-4 py-2">{line.systemQty}</td> : null}
                  <td className="px-4 py-2">
                    <InventoryForm
                      action={updateCountLineAction}
                      submitLabel="Save"
                      fields={[
                        { name: 'countId', label: 'Count', type: 'hidden', defaultValue: open.id },
                        { name: 'lineId', label: 'Line', type: 'hidden', defaultValue: line.id },
                        {
                          name: 'countedQty',
                          label: 'Counted',
                          type: 'number',
                          required: true,
                          defaultValue: line.countedQty === null ? '' : String(line.countedQty),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <InventoryForm
            action={submitCountAction}
            submitLabel="Submit count"
            fields={[{ name: 'countId', label: 'Count', type: 'hidden', defaultValue: open.id }]}
          />
        </Surface>
      ) : null}
    </>
  );
}
