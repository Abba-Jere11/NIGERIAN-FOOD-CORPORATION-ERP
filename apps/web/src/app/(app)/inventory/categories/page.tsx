import type { InventoryCategoryView, InventoryContextView, MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { upsertCategoryAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Categories — Inventory — NFC' };

export default async function InventoryCategoriesPage({
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
  const canRead = resolved.consolidated || Boolean(resolved.entityId);
  const rows = canRead
    ? await apiFetch<InventoryCategoryView[]>('/api/inventory/categories', {
        query: inventoryApiQuery(resolved),
      })
    : [];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Categories"
        description="Categories are per subsidiary. Add a key only when this subsidiary needs a new bucket; do not duplicate wheat, flour or livestock under a generic tree."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No categories" description="Select a subsidiary to manage its categories." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Key</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                  <td className="px-4 py-2">{row.key}</td>
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.config') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Add or rename a category" />
          <InventoryForm
            action={upsertCategoryAction}
            entityId={resolved.entityId}
            fields={[
              { name: 'key', label: 'Key', required: true },
              { name: 'name', label: 'Name', required: true },
            ]}
          />
        </Surface>
      ) : resolved.consolidated ? (
        <p className="mt-4 text-[13px] text-ink-600">Select a subsidiary to add or rename categories.</p>
      ) : null}
    </>
  );
}
