import type {
  InventoryContextView,
  MeView,
  StockIssueView,
  StockReturnView,
  SupplierReturnableLineView,
} from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { ReceiveReturnForm, SupplierReturnForm } from '../_components/ReturnForms';
import { stockReturnAction } from '../desk-actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Returns — Inventory — NFC' };

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; kind?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<InventoryContextView>('/api/inventory/context'),
  ]);
  const resolved = resolveInventoryScope(context, query.scope);
  const entityId = resolved.entityId;
  const canReceive = me.permissions.includes('inventory.issue') && Boolean(entityId);
  const canSupplier = me.permissions.includes('inventory.return.supplier') && Boolean(entityId);
  const [rows, issues, eligible] = await Promise.all([
    resolved.consolidated || entityId
      ? apiFetch<StockReturnView[]>('/api/inventory/returns', { query: inventoryApiQuery(resolved) })
      : Promise.resolve([] as StockReturnView[]),
    canReceive && entityId
      ? apiFetch<StockIssueView[]>('/api/inventory/issues', { query: { entityId } })
      : Promise.resolve([] as StockIssueView[]),
    canSupplier && entityId
      ? apiFetch<SupplierReturnableLineView[]>('/api/inventory/returns/supplier-eligible', {
          query: { entityId },
        }).catch(() => [] as SupplierReturnableLineView[])
      : Promise.resolve([] as SupplierReturnableLineView[]),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Returns"
        description="Stock returned by a department goes into quarantine for GM QC. Returns to a supplier leave from rejected or quarantined stock (RET-)."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No returns" description="Returns from departments and to suppliers appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">From / to</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">{row.kind === 'SUPPLIER_RETURN' ? 'To supplier' : 'Received'}</td>
                  <td className="px-4 py-2">
                    {row.lines.map((line) => `${line.itemCode} × ${line.quantity}`).join(', ')}
                  </td>
                  <td className="px-4 py-2">
                    {row.kind === 'SUPPLIER_RETURN'
                      ? (row.vendorName ?? '—')
                      : [row.departmentLabel, row.returnedByName].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-2">{row.reason}</td>
                  <td className="px-4 py-2">{row.occurredOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {canReceive && query.kind !== 'SUPPLIER_RETURN' && entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Receive a return" description="The stock lands in quarantine until the GM releases it." />
          <ReceiveReturnForm action={stockReturnAction} entityId={entityId} issues={issues} today={today} />
        </Surface>
      ) : null}
      {canSupplier && query.kind !== 'RECEIVE_RETURN' && entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Return to supplier" />
          <SupplierReturnForm action={stockReturnAction} entityId={entityId} lines={eligible} today={today} />
        </Surface>
      ) : null}
    </>
  );
}
