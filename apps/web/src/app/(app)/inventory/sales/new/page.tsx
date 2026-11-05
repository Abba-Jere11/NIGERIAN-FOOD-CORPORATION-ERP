import type {
  InventoryContextView,
  InventoryItemListView,
  SalesCustomerOption,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../../InventoryForm';
import { createSalesAction } from '../../actions';
import { resolveInventoryScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New sales order — Inventory — NFC' };

export default async function NewSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<InventoryContextView>('/api/inventory/context');
  const resolved = resolveInventoryScope(context, query.scope);
  const today = new Date().toISOString().slice(0, 10);
  const [items, warehouses, customers] = resolved.entityId
    ? await Promise.all([
        apiFetch<InventoryItemListView[]>('/api/inventory/items', { query: { entityId: resolved.entityId } }),
        apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } }),
        apiFetch<SalesCustomerOption[]>('/api/inventory/sales/customers', {
          query: { entityId: resolved.entityId },
        }),
      ])
    : [[], [], []];
  return (
    <>
      <PageHeader eyebrow="Inventory" title="New sales order" description="Draft against a customer. Approval reserves stock." />
      <Surface>
        <InventoryForm
          action={createSalesAction}
          entityId={resolved.entityId}
          submitLabel="Save draft"
          fields={[
            { name: 'scope', label: 'Scope', defaultValue: resolved.entityCode, type: 'hidden' },
            {
              name: 'customerId',
              label: 'Customer',
              required: true,
              options: customers.map((row) => ({ value: row.id, label: row.name })),
            },
            { name: 'occurredOn', label: 'Order date', type: 'date', defaultValue: today, required: true },
            { name: 'dueOn', label: 'Due date', type: 'date' },
            { name: 'terms', label: 'Terms' },
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
              options: items.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` })),
            },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true },
            { name: 'unitPriceKobo', label: 'Unit price (kobo)', type: 'number', required: true },
          ]}
        />
      </Surface>
    </>
  );
}
