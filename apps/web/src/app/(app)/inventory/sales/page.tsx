import type { InventoryContextView, MeView, SalesOrderView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { inventoryApiQuery, inventoryScopeParam, resolveInventoryScope, withInvScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales — Inventory — NFC' };

export default async function SalesListPage({
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
      ? await apiFetch<SalesOrderView[]>('/api/inventory/sales', { query: inventoryApiQuery(resolved) })
      : [];
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Sales"
        description="Reserve stock, dispatch, then invoice. Finance collects payment on the AR invoice."
        actions={
          me.permissions.includes('sales.order.create') && resolved.entityId ? (
            <Link href={withInvScope('/inventory/sales/new', resolved.entityCode)} className="underline">
              New order
            </Link>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No sales orders" description="Draft and reserved orders appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                {resolved.consolidated ? <th className="px-4 py-2">Entity</th> : null}
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const value = row.lines.reduce((sum, line) => sum + line.unitPriceKobo * line.quantity, 0);
                return (
                  <tr key={row.id} className="border-b border-ink-100">
                    {resolved.consolidated ? <td className="px-4 py-2">{row.entityCode}</td> : null}
                    <td className="px-4 py-2">
                      <Link
                        href={withInvScope(`/inventory/sales/${row.id}`, row.entityCode ?? inventoryScopeParam(resolved))}
                        className="underline"
                      >
                        {row.referenceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{row.customerName}</td>
                    <td className="tabular px-4 py-2">{formatKobo(BigInt(value))}</td>
                    <td className="px-4 py-2">{row.status.replaceAll('_', ' ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
