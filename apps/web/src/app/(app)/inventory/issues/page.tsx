import type {
  InventoryContextView,
  MeView,
  StockIssueView,
  WarehouseView,
} from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { SmartStockForm } from '../_components/DeskWidgets';
import { issueAction } from '../actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Issues — Inventory — NFC' };

export default async function InventoryIssuesPage({
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
  const queryParams = inventoryApiQuery(resolved);
  const [rows, warehouses] =
    resolved.consolidated || resolved.entityId
      ? await Promise.all([
          apiFetch<StockIssueView[]>('/api/inventory/issues', { query: queryParams }),
          resolved.entityId
            ? apiFetch<WarehouseView[]>('/api/inventory/warehouses', { query: { entityId: resolved.entityId } })
            : Promise.resolve([] as WarehouseView[]),
        ])
      : [[], []];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Issues"
        description="Issue available stock with a reason (ISS-). Issues post immediately unless their value reaches the Lane B threshold, which then needs ED Operations and ED Finance approval. Quarantined stock cannot be issued."
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {rows.length === 0 ? (
          <EmptyState title="No issues" description="Issued stock to a department, project or production appears here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Recipient</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">{row.warehouseName}</td>
                  <td className="px-4 py-2">
                    {row.destinationType}
                    {row.destinationLabel ? ` · ${row.destinationLabel}` : ''}
                  </td>
                  <td className="px-4 py-2">{row.lines.map((line) => `${line.itemCode} × ${line.quantity}`).join(', ')}</td>
                  <td className="px-4 py-2">{row.recipientName ?? '—'}</td>
                  <td className="px-4 py-2">{row.reason}</td>
                  <td className="px-4 py-2">{row.status === 'PENDING_APPROVAL' ? 'Awaiting approval' : row.status.replaceAll('_', ' ').toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('inventory.issue') && resolved.entityId ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Issue stock" />
          <SmartStockForm
            action={issueAction}
            entityId={resolved.entityId}
            warehouses={warehouses}
            submitLabel="Review Issue"
            reviewKind="issue"
            extraFields={
              <>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Destination</span>
                  <select name="destinationType" required className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5" defaultValue="department">
                    <option value="department">Department</option>
                    <option value="project">Project</option>
                  </select>
                </label>
                <p className="text-[12px] text-ink-600">
                  Production issues are raised from a production order, not here.
                </p>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Destination label</span>
                  <input name="destinationLabel" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Received by</span>
                  <input name="recipientName" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Reason</span>
                  <input name="reason" required className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
                <label className="block text-[13px]">
                  <span className="font-semibold text-ink-700">Date</span>
                  <input name="occurredOn" type="date" required defaultValue={today} className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
              </>
            }
          />
        </Surface>
      ) : null}
    </>
  );
}
