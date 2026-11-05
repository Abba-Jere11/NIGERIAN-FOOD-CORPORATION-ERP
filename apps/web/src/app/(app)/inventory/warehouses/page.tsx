import type { InventoryContextView, MeView, WarehouseView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { createWarehouseAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Warehouses — Inventory — NFC' };

export default async function WarehousesPage({
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
      ? await apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: inventoryApiQuery(resolved) })
      : [];
  return (
    <>
      <PageHeader eyebrow="Inventory" title="Warehouses" description="Stores, yards, plants and cold rooms. DMA uses a cold room." />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No warehouses" description="Add a store or cold room for this subsidiary." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                  <td className="px-4 py-2">{row.code}</td>
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.kind.replace('_', ' ')}</td>
                  <td className="px-4 py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.config') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Add warehouse" />
          <InventoryForm
            action={createWarehouseAction}
            entityId={resolved.entityId}
            fields={[
              { name: 'code', label: 'Code', required: true },
              { name: 'name', label: 'Name', required: true },
              {
                name: 'kind',
                label: 'Kind',
                required: true,
                options: [
                  { value: 'store', label: 'Store' },
                  { value: 'cold_room', label: 'Cold room' },
                  { value: 'yard', label: 'Yard' },
                  { value: 'plant', label: 'Plant' },
                ],
              },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
