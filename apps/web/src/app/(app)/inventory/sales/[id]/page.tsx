import type { MeView, SalesOrderView, WorkflowInstanceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ui/Dialog';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { workflowAction } from '../../../workflows/actions';
import { InventoryForm } from '../../InventoryForm';
import {
  cancelSalesAction,
  dispatchSalesAction,
  invoiceSalesAction,
  returnSalesAction,
  submitSalesAction,
} from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales order — Inventory — NFC' };

export default async function SalesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  let order: SalesOrderView;
  try {
    order = await apiFetch<SalesOrderView>(`/api/inventory/sales/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const workflow = order.workflowInstanceId
    ? await apiFetch<WorkflowInstanceView>(`/api/workflows/${order.workflowInstanceId}`).catch(() => null)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const firstOpen = order.lines.find((line) => line.dispatchedQty < line.quantity);
  return (
    <>
      <PageHeader
        eyebrow={order.entityCode ?? 'Sales'}
        title={order.referenceNumber}
        description={`${order.customerName} · ${order.occurredOn}`}
        actions={<StatusBadge status={order.status} />}
      />
      <p className="mb-4 text-[13px]">
        Customer:{' '}
        <Link href={`/finance/customers/${order.customerId}`} className="underline">
          {order.customerName}
        </Link>
        {order.receivableInvoiceReference ? ` · Invoice ${order.receivableInvoiceReference}` : ''}
      </p>
      <Surface padded={false} className="mb-4">
        <SurfaceHeader title="Lines" />
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Reserved</th>
              <th className="px-4 py-2">Dispatched</th>
              <th className="px-4 py-2">Price</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-b border-ink-100">
                <td className="px-4 py-2">
                  {line.itemCode} · {line.itemName}
                </td>
                <td className="tabular px-4 py-2">{line.quantity}</td>
                <td className="tabular px-4 py-2">{line.reservedQty}</td>
                <td className="tabular px-4 py-2">{line.dispatchedQty}</td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(line.unitPriceKobo))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
      {order.dispatches.length > 0 ? (
        <Surface padded={false} className="mb-4">
          <SurfaceHeader title="Dispatches" />
          <table className="w-full text-left text-[13px]">
            <tbody>
              {order.dispatches.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">{row.referenceNumber}</td>
                  <td className="px-4 py-2">{row.destination}</td>
                  <td className="px-4 py-2">{row.status}</td>
                  <td className="px-4 py-2">{row.occurredOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      ) : null}
      {order.status === 'DRAFT' && me.permissions.includes('sales.order.create') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Submit" />
          <InventoryForm
            action={submitSalesAction}
            submitLabel="Submit for approval"
            fields={[
              { name: 'id', label: 'id', type: 'hidden', defaultValue: order.id },
              { name: 'rowVersion', label: 'rowVersion', type: 'hidden', defaultValue: String(order.rowVersion) },
            ]}
          />
        </Surface>
      ) : null}
      {['RESERVED', 'PART_DISPATCHED'].includes(order.status) &&
      me.permissions.includes('sales.dispatch') &&
      firstOpen ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Dispatch" />
          <InventoryForm
            action={dispatchSalesAction}
            submitLabel="Dispatch"
            fields={[
              { name: 'id', label: 'id', type: 'hidden', defaultValue: order.id },
              { name: 'orderLineId', label: 'orderLineId', type: 'hidden', defaultValue: firstOpen.id },
              { name: 'destination', label: 'Destination', required: true },
              { name: 'vehicle', label: 'Vehicle' },
              { name: 'driver', label: 'Driver' },
              { name: 'occurredOn', label: 'Date', type: 'date', defaultValue: today, required: true },
              {
                name: 'quantity',
                label: 'Quantity',
                type: 'number',
                required: true,
                defaultValue: String(firstOpen.quantity - firstOpen.dispatchedQty),
              },
              { name: 'batchCode', label: 'Batch' },
            ]}
          />
        </Surface>
      ) : null}
      {['DISPATCHED', 'PART_DISPATCHED'].includes(order.status) && me.permissions.includes('sales.invoice') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Invoice" />
          <InventoryForm
            action={invoiceSalesAction}
            submitLabel="Raise AR invoice"
            fields={[
              { name: 'id', label: 'id', type: 'hidden', defaultValue: order.id },
              { name: 'occurredOn', label: 'Invoice date', type: 'date', defaultValue: today },
            ]}
          />
        </Surface>
      ) : null}
      {['DRAFT', 'AWAITING_APPROVAL', 'RESERVED'].includes(order.status) &&
      me.permissions.includes('sales.order.create') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Cancel" />
          <div className="px-4 py-3">
            <ActionDialog
              triggerLabel="Cancel order"
              triggerVariant="danger"
              title="Cancel sales order"
              submitLabel="Cancel"
              successMessage="Sales order cancelled."
              action={cancelSalesAction}
              requireReason
              hiddenFields={{ id: order.id, rowVersion: String(order.rowVersion) }}
            />
          </div>
        </Surface>
      ) : null}
      {['DISPATCHED', 'PART_DISPATCHED', 'INVOICED'].includes(order.status) &&
      me.permissions.includes('sales.dispatch') ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Return" description="Reversing movements and journals. Originals stay." />
          <InventoryForm
            action={returnSalesAction}
            submitLabel="Post return"
            fields={[
              { name: 'id', label: 'id', type: 'hidden', defaultValue: order.id },
              { name: 'reason', label: 'Reason', required: true },
              { name: 'occurredOn', label: 'Date', type: 'date', defaultValue: today, required: true },
            ]}
          />
        </Surface>
      ) : null}
      {workflow && workflow.allowedActions.length > 0 ? (
        <Surface className="mb-4">
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
