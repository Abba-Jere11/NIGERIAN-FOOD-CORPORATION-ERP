import type { InventoryContextView, MeView, QcDecisionView, QuarantineLineView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { InventoryForm } from '../InventoryForm';
import { qcDecisionAction } from '../desk-actions';
import { inventoryApiQuery, resolveInventoryScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'QC — Inventory — NFC' };

function origin(line: QuarantineLineView): string {
  if (line.grnReference) return `${line.grnReference}${line.procurementReference ? ` · ${line.procurementReference}` : ''}`;
  if (line.productionReference) return `Production ${line.productionReference}`;
  if (line.returnReference) return `Return ${line.returnReference}`;
  return 'Quarantined stock';
}

export default async function QcPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<InventoryContextView>('/api/inventory/context'),
  ]);
  const resolved = resolveInventoryScope(context, query.scope);
  const params = inventoryApiQuery(resolved);
  const [lines, decisions] =
    resolved.consolidated || resolved.entityId
      ? await Promise.all([
          apiFetch<QuarantineLineView[]>('/api/inventory/qc', { query: params }),
          apiFetch<QcDecisionView[]>('/api/inventory/qc/decisions', { query: params }),
        ])
      : [[], []];
  const canDecide = me.permissions.includes('inventory.qc.release');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="QC release and reject"
        description="Quarantined stock is on hand but never available. The General Manager releases it to available stock or rejects it, with a reason. Decisions are recorded in the inventory audit trail only."
      />
      <Surface padded={false}>
        <SurfaceHeader title={`Quarantined · ${resolved.label}`} />
        {lines.length === 0 ? (
          <EmptyState title="Nothing in quarantine" description="Quarantined receipts, returns and production output appear here." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {lines.map((line) => {
              const key = [line.itemId, line.warehouseId, line.batchId, line.serialId, line.grnId, line.productionOrderId, line.returnId].join(':');
              return (
                <li key={key} className="px-4 py-3" data-testid="qc-line">
                  <p className="text-[13px] text-ink-900">
                    <span className="font-semibold">
                      {line.itemCode} — {line.itemName}
                    </span>{' '}
                    · {line.quantity} {line.uomCode} · {line.warehouseName}
                    {line.batchCode ? ` · batch ${line.batchCode}` : ''}
                    {line.serialCode ? ` · serial ${line.serialCode}` : ''}
                  </p>
                  <p className="text-[12px] text-ink-600">{origin(line)}</p>
                  {canDecide ? (
                    <InventoryForm
                      action={qcDecisionAction}
                      entityId={line.entityId}
                      submitLabel="Record decision"
                      fields={[
                        { name: 'itemId', label: '', type: 'hidden', defaultValue: line.itemId },
                        { name: 'warehouseId', label: '', type: 'hidden', defaultValue: line.warehouseId },
                        { name: 'batchId', label: '', type: 'hidden', defaultValue: line.batchId ?? '' },
                        { name: 'serialId', label: '', type: 'hidden', defaultValue: line.serialId ?? '' },
                        { name: 'grnId', label: '', type: 'hidden', defaultValue: line.grnId ?? '' },
                        { name: 'productionOrderId', label: '', type: 'hidden', defaultValue: line.productionOrderId ?? '' },
                        { name: 'returnId', label: '', type: 'hidden', defaultValue: line.returnId ?? '' },
                        { name: 'occurredOn', label: '', type: 'hidden', defaultValue: today },
                        {
                          name: 'decision',
                          label: 'Decision',
                          required: true,
                          options: [
                            { value: 'RELEASE', label: 'Release to available stock' },
                            { value: 'REJECT', label: 'Reject' },
                          ],
                        },
                        {
                          name: 'quantity',
                          label: 'Quantity',
                          type: 'number',
                          required: true,
                          defaultValue: String(line.quantity),
                        },
                        { name: 'reason', label: 'Reason', required: true },
                      ]}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Surface>
      <Surface padded={false} className="mt-4">
        <SurfaceHeader title="Decisions" />
        {decisions.length === 0 ? (
          <EmptyState title="No QC decisions yet" description="Releases and rejections appear here." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Decision</th>
                <th className="px-4 py-2">Quantity</th>
                <th className="px-4 py-2">Origin</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    {row.itemCode} — {row.itemName}
                  </td>
                  <td className="px-4 py-2">{row.decision === 'RELEASE' ? 'Released' : 'Rejected'}</td>
                  <td className="px-4 py-2 tabular">{row.quantity}</td>
                  <td className="px-4 py-2">
                    {row.grnReference ?? row.productionReference ?? row.procurementReference ?? '—'}
                  </td>
                  <td className="px-4 py-2">{row.reason}</td>
                  <td className="px-4 py-2">{row.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
