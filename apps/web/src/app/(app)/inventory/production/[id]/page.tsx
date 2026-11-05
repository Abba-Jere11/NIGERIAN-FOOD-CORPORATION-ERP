import type { MeView, ProductionOrderView, WorkflowInstanceView } from '@nfc/shared';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ui/Dialog';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { workflowAction } from '../../../workflows/actions';
import { InventoryForm } from '../../InventoryForm';
import { cancelProductionAction, completeProductionAction, startProductionAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Production order — Inventory — NFC' };

export default async function ProductionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  let order: ProductionOrderView;
  try {
    order = await apiFetch<ProductionOrderView>(`/api/inventory/production/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const workflow = order.workflowInstanceId
    ? await apiFetch<WorkflowInstanceView>(`/api/workflows/${order.workflowInstanceId}`).catch(() => null)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        eyebrow={order.entityCode ?? 'Production'}
        title={order.referenceNumber}
        description={`${order.finishedItemCode} · ${order.finishedItemName} · ${order.warehouseName}`}
        actions={<StatusBadge status={order.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader title="Output" />
          <dl className="grid grid-cols-2 gap-2 px-4 py-3 text-[13px]">
            <dt className="text-ink-500">Planned</dt>
            <dd>{order.plannedOutputQty}</dd>
            <dt className="text-ink-500">Actual</dt>
            <dd>{order.actualOutputQty ?? '—'}</dd>
            <dt className="text-ink-500">Waste</dt>
            <dd>{order.wasteQty}</dd>
            <dt className="text-ink-500">Yield</dt>
            <dd>{order.yieldPct === null ? '—' : `${Math.round(order.yieldPct * 10000) / 100}%`}</dd>
            <dt className="text-ink-500">Finished batch</dt>
            <dd>{order.finishedBatchCode ?? '—'}</dd>
            <dt className="text-ink-500">Produced on</dt>
            <dd>{order.producedOn ?? '—'}</dd>
          </dl>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="Inputs" />
          <table className="w-full text-left text-[13px]">
            <tbody>
              {order.inputs.map((line) => (
                <tr key={line.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    {line.itemCode} · {line.itemName}
                  </td>
                  <td className="tabular px-4 py-2">{line.plannedQty}</td>
                  <td className="tabular px-4 py-2">{line.actualQty ?? '—'}</td>
                  <td className="px-4 py-2">{line.batchCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      </div>
      {order.batchLinks.length > 0 ? (
        <Surface padded={false} className="mt-4">
          <SurfaceHeader title="Batch trace" description="Finished batch linked to consumed raw batches." />
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2">Finished</th>
                <th className="px-4 py-2">Raw</th>
                <th className="px-4 py-2">Qty</th>
              </tr>
            </thead>
            <tbody>
              {order.batchLinks.map((link) => (
                <tr key={`${link.finishedBatchCode}-${link.rawBatchCode}`} className="border-b border-ink-100">
                  <td className="px-4 py-2">{link.finishedBatchCode}</td>
                  <td className="px-4 py-2">{link.rawBatchCode}</td>
                  <td className="tabular px-4 py-2">{link.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      ) : null}
      {order.status === 'PLANNED' && me.permissions.includes('production.create') ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Start" description="Consumes raw materials into WIP." />
          <InventoryForm
            action={startProductionAction}
            submitLabel="Start production"
            fields={[
              { name: 'id', label: 'id', type: 'hidden', defaultValue: order.id },
              { name: 'rowVersion', label: 'rowVersion', type: 'hidden', defaultValue: String(order.rowVersion) },
              { name: 'occurredOn', label: 'Date', type: 'date', defaultValue: today, required: true },
              { name: 'inputItemId', label: 'inputItemId', type: 'hidden', defaultValue: order.inputs[0]?.itemId },
              {
                name: 'actualQty',
                label: 'Actual raw qty',
                type: 'number',
                defaultValue: String(order.inputs[0]?.plannedQty ?? ''),
                required: true,
              },
              { name: 'batchCode', label: 'Raw batch' },
            ]}
          />
        </Surface>
      ) : null}
      {order.status === 'IN_PROGRESS' && me.permissions.includes('production.complete') ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Submit complete" />
          <InventoryForm
            action={completeProductionAction}
            submitLabel="Submit for approval"
            fields={[
              { name: 'id', label: 'id', type: 'hidden', defaultValue: order.id },
              { name: 'rowVersion', label: 'rowVersion', type: 'hidden', defaultValue: String(order.rowVersion) },
              { name: 'actualOutputQty', label: 'Actual output', type: 'number', required: true },
              { name: 'wasteQty', label: 'Waste qty', type: 'number', defaultValue: '0' },
              { name: 'wasteReason', label: 'Waste reason' },
              { name: 'finishedBatchCode', label: 'Finished batch', required: true },
              { name: 'producedOn', label: 'Produced on', type: 'date', defaultValue: today, required: true },
            ]}
          />
        </Surface>
      ) : null}
      {(order.status === 'PLANNED' || order.status === 'IN_PROGRESS') &&
      me.permissions.includes('production.create') ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Cancel" />
          <div className="px-4 py-3">
            <ActionDialog
              triggerLabel="Cancel order"
              triggerVariant="danger"
              title="Cancel production"
              submitLabel="Cancel"
              successMessage="Production cancelled."
              action={cancelProductionAction}
              requireReason
              hiddenFields={{ id: order.id, rowVersion: String(order.rowVersion) }}
            />
          </div>
        </Surface>
      ) : null}
      {workflow && workflow.allowedActions.length > 0 ? (
        <Surface className="mt-4">
          <SurfaceHeader title="Approval" description="A different user must approve. Preparer cannot approve." />
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {workflow.allowedActions.map((action) => (
              <ActionDialog
                key={action}
                triggerLabel={action}
                triggerVariant={action === 'REJECT' ? 'danger' : 'primary'}
                title={action}
                submitLabel={action}
                successMessage="Recorded."
                action={workflowAction}
                requireReason={action === 'REJECT'}
                hiddenFields={{
                  instanceId: workflow.id,
                  action,
                  rowVersion: String(workflow.rowVersion),
                }}
              />
            ))}
          </div>
        </Surface>
      ) : null}
    </>
  );
}
