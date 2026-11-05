import type {
  InventoryCategoryView,
  InventoryContextView,
  UnitOfMeasureView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../../InventoryForm';
import { createItemAction } from '../../actions';
import { resolveInventoryScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New item — Inventory — NFC' };

export default async function NewInventoryItemPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const [categories, units, warehouses] = resolved.entityId
    ? await Promise.all([
        apiFetch<InventoryCategoryView[]>('/api/inventory/categories', { query: { entityId: resolved.entityId } }),
        apiFetch<UnitOfMeasureView[]>('/api/inventory/units'),
        apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } }),
      ])
    : [[], [], []];
  return (
    <>
      <PageHeader eyebrow="Inventory" title="New item" description="Weighted-average cost. Tracking is none, batch or serial." />
      {!resolved.entityId ? (
        <Surface>
          <EmptyState title="Select a subsidiary" description="Items are created in one subsidiary. Switch from Consolidated to add an item." />
        </Surface>
      ) : (
      <Surface>
        <input type="hidden" name="scope" value={resolved.entityCode ?? ''} form="unused" />
        <InventoryForm
          action={createItemAction}
          entityId={resolved.entityId}
          fields={[
            { name: 'scope', label: 'Scope', defaultValue: resolved.entityCode, type: 'hidden' },
            { name: 'code', label: 'Code', required: true },
            { name: 'name', label: 'Name', required: true },
            {
              name: 'categoryId',
              label: 'Category',
              required: true,
              options: categories.map((row) => ({ value: row.id, label: row.name })),
            },
            {
              name: 'uomId',
              label: 'Unit',
              required: true,
              options: units.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
            },
            {
              name: 'defaultWarehouseId',
              label: 'Default warehouse',
              options: [{ value: '', label: '—' }, ...warehouses.map((row) => ({ value: row.id, label: row.name }))],
            },
            { name: 'reorderLevel', label: 'Reorder level', type: 'number', defaultValue: '0' },
            {
              name: 'trackingMode',
              label: 'Tracking',
              required: true,
              options: [
                { value: 'none', label: 'None' },
                { value: 'batch_lot', label: 'Batch / lot' },
                { value: 'serial', label: 'Serial' },
              ],
            },
          ]}
        />
      </Surface>
      )}
    </>
  );
}
