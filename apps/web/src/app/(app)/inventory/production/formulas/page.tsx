import type { InventoryContextView, InventoryItemListView, MeView, ProductionFormulaView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../../InventoryForm';
import { createFormulaAction } from '../../desk-actions';
import { inventoryApiQuery, resolveInventoryScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Formulas — Production — NFC' };

const INPUT_ROWS = 4;

export default async function FormulasPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<InventoryContextView>('/api/inventory/context'),
  ]);
  const resolved = resolveInventoryScope(context, query.scope);
  const [formulas, items] =
    resolved.consolidated || resolved.entityId
      ? await Promise.all([
          apiFetch<ProductionFormulaView[]>('/api/inventory/formulas', { query: inventoryApiQuery(resolved) }),
          resolved.entityId
            ? apiFetch<InventoryItemListView[]>('/api/inventory/items', { query: { entityId: resolved.entityId } })
            : Promise.resolve([] as InventoryItemListView[]),
        ])
      : [[], []];
  const options = items.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }));

  return (
    <>
      <PageHeader
        eyebrow="Production"
        title="Formulas"
        description="Raw materials per base quantity of finished output. Saving an existing code adds a new version and retires the previous one."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {formulas.length === 0 ? (
          <EmptyState title="No formulas" description="Formulas scale raw materials when a production order is planned." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {formulas.map((row) => (
              <li key={row.id} className="px-4 py-3 text-[13px]">
                <p className="font-semibold text-ink-900">
                  {row.code} v{row.version} — {row.name}
                  {row.status === 'RETIRED' ? ' · retired' : ''}
                </p>
                <p className="text-ink-600">
                  Makes {row.baseOutputQty} × {row.finishedItemCode} {row.finishedItemName} from{' '}
                  {row.lines.map((line) => `${line.quantity} × ${line.itemCode}`).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Surface>
      {me.permissions.includes('production.create') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Save formula" />
          <InventoryForm
            action={createFormulaAction}
            entityId={resolved.entityId}
            submitLabel="Save formula"
            fields={[
              { name: 'code', label: 'Code', required: true },
              { name: 'name', label: 'Name', required: true },
              { name: 'finishedItemId', label: 'Finished item', required: true, options },
              { name: 'baseOutputQty', label: 'Base output quantity', type: 'number', required: true },
              ...Array.from({ length: INPUT_ROWS }, (_, index) => [
                {
                  name: 'inputItemId',
                  label: `Raw material ${index + 1}`,
                  required: index === 0,
                  options: index === 0 ? options : [{ value: '', label: '—' }, ...options],
                },
                { name: 'inputQty', label: `Quantity ${index + 1}`, type: 'number', required: index === 0 },
              ]).flat(),
            ]}
          />
        </Surface>
      ) : null}
    </>
  );
}
