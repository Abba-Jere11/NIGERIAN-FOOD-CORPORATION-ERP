import type { InventoryContextView, MeView, ProductionOrderView } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Production — Inventory — NFC' };

export default async function ProductionListPage({
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
      ? await apiFetch<ProductionOrderView[]>('/api/inventory/production', {
          query: inventoryApiQuery(resolved),
        })
      : [];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Production"
        description="Plan raw consumption, then complete to finished goods. GM or ED Operations approves."
        actions={
          me.permissions.includes('production.create') && resolved.entityId ? (
            <Link href={withInvScope('/inventory/production/new', resolved.entityCode)} className="underline">
              New order
            </Link>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No production orders" description="Planned mill runs appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Finished item</th>
                <th className="px-4 py-2">Planned</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                  <td className="px-4 py-2">
                    <Link
                      href={withInvScope(`/inventory/production/${row.id}`, row.entityCode ?? inventoryScopeParam(resolved))}
                      className="underline"
                    >
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {row.finishedItemCode} · {row.finishedItemName}
                  </td>
                  <td className="tabular px-4 py-2">{row.plannedOutputQty}</td>
                  <td className="px-4 py-2">{row.status.replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
