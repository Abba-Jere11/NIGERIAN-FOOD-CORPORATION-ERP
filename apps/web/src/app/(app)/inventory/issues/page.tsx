import type {
  InventoryContextView,
  InventoryItemListView,
  MeView,
  StockIssueView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { issueAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Issues — Inventory — NFC' };

export default async function InventoryIssuesPage({
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
  const queryParams = inventoryApiQuery(resolved);
  const [rows, items, warehouses] =
    resolved.consolidated || resolved.entityId
      ? await Promise.all([
          apiFetch<StockIssueView[]>('/api/inventory/issues', { query: queryParams }),
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
        title="Issues"
        description="Officer issues with a mandatory reason. Destination type is enough; production orders are M14."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No issues" description="Issued stock to a department, project or production appears here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="px-4 py-2">
                    {row.destinationType}
                    {row.destinationLabel ? ` · ${row.destinationLabel}` : ''}
                  </td>
                  <td className="px-4 py-2">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.issue') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Issue stock" />
          <InventoryForm
            action={issueAction}
            entityId={resolved.entityId}
            submitLabel="Issue"
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
              { name: 'quantity', label: 'Quantity', type: 'number', required: true },
              { name: 'batchCode', label: 'Batch (if tracked)' },
              { name: 'serialCode', label: 'Serial (if tracked)' },
              {
                name: 'destinationType',
                label: 'Destination',
                required: true,
                options: [
                  { value: 'department', label: 'Department' },
                  { value: 'project', label: 'Project' },
                  { value: 'production', label: 'Production' },
                ],
              },
              { name: 'destinationLabel', label: 'Destination label' },
              { name: 'reason', label: 'Reason', required: true },
              { name: 'occurredOn', label: 'Date', type: 'date', required: true, defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
