import type {
  InventoryContextView,
  InventoryItemListView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../../InventoryForm';
import { createProductionAction } from '../../actions';
import { resolveInventoryScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New production — Inventory — NFC' };

export default async function NewProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const [items, warehouses] = resolved.entityId
    ? await Promise.all([
        apiFetch<InventoryItemListView[]>('/api/inventory/items', { query: { entityId: resolved.entityId } }),
        apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } }),
      ])
    : [[], []];
  const options = items.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }));
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="New production order"
        description="Plan finished output and the raw materials to consume."
      />
      <Surface>
        <InventoryForm
          action={createProductionAction}
          entityId={resolved.entityId}
          submitLabel="Save planned order"
          fields={[
            { name: 'scope', label: 'Scope', defaultValue: resolved.entityCode, type: 'hidden' },
            {
              name: 'warehouseId',
              label: 'Warehouse',
              required: true,
              options: warehouses.map((row) => ({ value: row.id, label: row.name })),
            },
            { name: 'finishedItemId', label: 'Finished item', required: true, options },
            { name: 'plannedOutputQty', label: 'Planned output', required: true, type: 'number' },
            { name: 'inputItemId', label: 'Raw material', required: true, options },
            { name: 'inputQty', label: 'Planned raw qty', required: true, type: 'number' },
            { name: 'inputBatchCode', label: 'Raw batch (if tracked)' },
          ]}
        />
      </Surface>
    </>
  );
}
