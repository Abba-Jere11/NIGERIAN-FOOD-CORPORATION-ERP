import type {
  FixedAssetView,
  InventoryContextView,
  InventoryItemListView,
  MeView,
  WarehouseView,
} from '@nfc/shared';
import { ASSET_CONDITIONS } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { AssetListWithLabels } from '../_components/AssetLabelSheet';
import { registerAssetAction } from '../desk-actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assets — Inventory — NFC' };

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; q?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<InventoryContextView>('/api/inventory/context'),
  ]);
  const resolved = resolveInventoryScope(context, query.scope);
  const entityId = resolved.entityId;
  const [rows, items, warehouses] = await Promise.all([
    resolved.consolidated || entityId
      ? apiFetch<FixedAssetView[]>('/api/inventory/assets', { query: inventoryApiQuery(resolved, { q: query.q }) })
      : Promise.resolve([] as FixedAssetView[]),
    entityId
      ? apiFetch<InventoryItemListView[]>('/api/inventory/items', { query: { entityId } })
      : Promise.resolve([] as InventoryItemListView[]),
    entityId
      ? apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId } })
      : Promise.resolve([] as WarehouseView[]),
  ]);
  const assetItems = items.filter((item) => item.asset);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Assets"
        description="Individually tracked equipment (AST-). Each asset keeps its serial, photo, custodian, location and full history. Assets received on a goods received note are registered automatically."
      />
      <Surface className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {query.scope ? <input type="hidden" name="scope" value={query.scope} /> : null}
          <label className="text-[13px]">
            <span className="font-semibold text-ink-700">Search</span>
            <input
              name="q"
              defaultValue={query.q ?? ''}
              placeholder="AST reference, serial or item"
              className="mt-1 block w-64 border border-ink-300 px-2 py-1.5"
            />
          </label>
          <button type="submit" className="border border-ink-300 px-3 py-1.5 text-[13px]">
            Search
          </button>
        </form>
      </Surface>
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No assets" description="Register equipment here or receive it on a goods received note." />
        ) : (
          <AssetListWithLabels assets={rows} />
        )}
      </Surface>
      {me.permissions.includes('inventory.asset.manage') && entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Register an asset" />
          <InventoryForm
            action={registerAssetAction}
            entityId={entityId}
            submitLabel="Register asset"
            fields={[
              {
                name: 'itemId',
                label: 'Asset item',
                required: true,
                options: assetItems.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` })),
              },
              { name: 'serialCode', label: 'Serial number' },
              {
                name: 'warehouseId',
                label: 'Store',
                options: [{ value: '', label: '—' }, ...warehouses.map((row) => ({ value: row.id, label: row.name }))],
              },
              { name: 'locationLabel', label: 'Location' },
              {
                name: 'condition',
                label: 'Condition',
                defaultValue: 'good',
                options: ASSET_CONDITIONS.map((value) => ({ value, label: value })),
              },
              { name: 'costNaira', label: 'Cost (₦)', type: 'number' },
              { name: 'acquiredOn', label: 'Acquired on', type: 'date' },
              { name: 'photo', label: 'Photo (optional)', type: 'file' },
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
