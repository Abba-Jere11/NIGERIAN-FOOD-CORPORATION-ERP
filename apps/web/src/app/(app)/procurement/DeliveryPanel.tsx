'use client';

import { useState } from 'react';
import type { ProcurementView, WarehouseView } from '@nfc/shared';
import { RECEIPT_DOCUMENT_KINDS } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { Button } from '@/components/ui/Button';
import { CONTROL_CLASS, SelectField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import {
  completeDeliveryAction,
  overrideShortageDeadlineAction,
  recordDeliveryAction,
  recordDeliveryNoteAction,
  requestCloseShortAction,
} from './actions';

export function DeliveryPanel({
  request,
  warehouses = [],
}: {
  request: ProcurementView;
  warehouses?: WarehouseView[];
}) {
  const outstanding = request.outstandingQuantity;
  const closePending = request.closeShort?.status === 'PENDING';
  const closeApproved = request.closeShort?.status === 'APPROVED';
  const canComplete = (outstanding === 0 || closeApproved) && request.paymentComplete;
  const present = new Set([
    ...request.receipts.flatMap((receipt) => receipt.documents.map((doc) => doc.kind)),
    ...request.deliveries.flatMap((delivery) => delivery.documents.map((doc) => doc.kind)),
  ]);
  const options = request.requiredDeliveryDocumentSet;
  const anyAttached = options.some((kind) => present.has(kind));

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-700">
        Ordered {request.lines.reduce((sum, line) => sum + line.quantity, 0) || request.quantity || 0}. Accepted{' '}
        {request.acceptedQuantityTotal}. Outstanding {outstanding}.
      </p>
      {options.length > 0 ? (
        <p className="text-[13px] text-ink-700">
          <span className="font-semibold text-ink-900">Delivery document {anyAttached ? '✓' : '○'}</span> — attach one
          of: {options.map((kind) => kind.replaceAll('_', ' ')).join(', ')}.
        </p>
      ) : null}
      {outstanding > 0 && request.lines.length > 0 ? (
        <DeliveryForm request={request} warehouses={warehouses} />
      ) : null}
      {request.status === 'AWAITING_DELIVERY' ? <DeliveryNoteForm request={request} /> : null}
      {request.status === 'PARTIALLY_RECEIVED' && outstanding > 0 && !closePending ? (
        <CloseShortForm request={request} />
      ) : null}
      {closePending ? (
        <p className="text-[13px] text-ink-700">A close-short request is awaiting Operations, then Finance.</p>
      ) : null}
      {(outstanding === 0 || closeApproved) && !request.paymentComplete ? (
        <p className="text-[13px] text-ink-700">
          Delivery is done. Record the remaining vendor payment before completing this request.
        </p>
      ) : null}
      {canComplete ? <CompleteForm request={request} /> : null}
    </div>
  );
}

function DeliveryNoteForm({ request }: { request: ProcurementView }) {
  const [state, formAction] = useToastAction(recordDeliveryNoteAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={request.id} />
      {state.status === 'error' ? (
        <ErrorState title="Note was not recorded" message={state.message} requestId={state.requestId} />
      ) : null}
      <TextField label="Received? No — note" name="note" required />
      <Button type="submit">Record not received</Button>
    </form>
  );
}

type ItemDraft = { received: string; accepted: string };

/**
 * One delivery: what applies to the whole consignment is entered once, then
 * each item is verified on its own row with its own quantities and remarks.
 */
function DeliveryForm({
  request,
  warehouses,
}: {
  request: ProcurementView;
  warehouses: WarehouseView[];
}) {
  const [state, formAction] = useToastAction(recordDeliveryAction);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `web-del-${request.id}-${Date.now()}`);
  const open = request.lines.filter((line) => line.outstandingQuantity > 0);
  const needsWarehouse = open.some((line) => line.stockItem || line.asset);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(() =>
    Object.fromEntries(
      open.map((line) => [line.id, { received: String(line.outstandingQuantity), accepted: String(line.outstandingQuantity) }]),
    ),
  );
  const [lastOk, setLastOk] = useState(state);
  if (state !== lastOk) {
    setLastOk(state);
    if (state.status === 'ok') setIdempotencyKey(`web-del-${request.id}-${Date.now()}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const update = (lineId: string, patch: Partial<ItemDraft>) =>
    setDrafts((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? { received: '0', accepted: '0' }), ...patch } }));
  const warehouseOptions = warehouses.map((row) => ({
    value: row.id,
    label: `${row.name} (${row.code})`,
  }));

  return (
    <form action={formAction} className="space-y-4" data-testid="delivery-form">
      <input type="hidden" name="id" value={request.id} />
      <input type="hidden" name="entityId" value={request.entityId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.status === 'error' ? (
        <ErrorState
          title="Delivery was not recorded"
          message={
            state.fieldErrors && Object.keys(state.fieldErrors).length > 0
              ? [
                  state.message,
                  ...Object.entries(state.fieldErrors).flatMap(([field, messages]) =>
                    messages.map((msg) => `${field}: ${msg}`),
                  ),
                ].join(' ')
              : state.message
          }
          requestId={state.requestId}
        />
      ) : null}

      <fieldset className="space-y-2 border border-ink-200 p-3">
        <legend className="px-1 text-[12px] font-semibold text-ink-900">Delivery details (whole delivery)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField label="Received date" name="receivedDate" type="date" required defaultValue={today} />
          <TextField label="Delivery location" name="location" required defaultValue={request.deliveryLocation ?? ''} />
          <label className="block">
            <span className="block text-[12px] font-semibold text-ink-900">
              Delivery document type
              <span className="ml-0.5 text-danger-600" aria-hidden="true">
                *
              </span>
            </span>
            <select
              name="documentKind"
              required
              className={CONTROL_CLASS}
              defaultValue={request.requiredDeliveryDocumentSet[0] ?? 'delivery_note'}
            >
              {RECEIPT_DOCUMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-ink-900">Delivery document</span>
            <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="mt-1 block w-full text-[13px]" />
          </label>
          {needsWarehouse ? (
            warehouses.length > 0 ? (
              <SelectField
                label="Warehouse"
                name="warehouseId"
                required
                options={warehouseOptions}
                defaultValue={warehouses[0]?.id}
                hint="Required for stock or asset lines so accepted quantity can post into inventory."
              />
            ) : (
              <p className="text-[13px] text-danger-700 sm:col-span-2">
                This delivery includes stock items, but {request.entityCode ?? 'this subsidiary'} has no active
                warehouse. Add one under Inventory → Warehouses, then return here.
              </p>
            )
          ) : null}
          <TextField label="Delivery remarks" name="notes" />
        </div>
      </fieldset>

      <div className="space-y-3">
        <p className="text-[12px] font-semibold text-ink-900">Verify each item</p>
        {request.lines.map((line) => {
          if (line.outstandingQuantity === 0) {
            return (
              <div key={line.id} className="border border-ink-100 bg-ink-50 px-3 py-2 text-[13px] text-ink-700">
                Item {line.lineNumber}: {line.description || line.categoryName || 'item'} — fully accepted ({line.acceptedQuantity}{' '}
                of {line.quantity}).
              </div>
            );
          }
          const draft = drafts[line.id] ?? { received: '0', accepted: '0' };
          const received = Number(draft.received) || 0;
          const accepted = Number(draft.accepted) || 0;
          const rejected = Math.max(received - accepted, 0);
          const staysShort = accepted < line.outstandingQuantity;
          const prefix = `item.${line.id}`;
          return (
            <fieldset key={line.id} className="space-y-2 border border-ink-200 p-3" data-testid={`delivery-item-${line.lineNumber}`}>
              <legend className="px-1 text-[13px] font-semibold text-ink-900">
                Item {line.lineNumber}: {line.description || line.categoryName || 'item'}
              </legend>
              <input type="hidden" name="itemLineId" value={line.id} />
              <input type="hidden" name={`${prefix}.quantityRejected`} value={String(rejected)} />
              <p className="text-[12px] text-ink-600">
                Ordered {line.quantity} {line.unitCode ?? ''} · accepted so far {line.acceptedQuantity} · outstanding{' '}
                {line.outstandingQuantity}
                {line.categoryName ? ` · ${line.categoryName}` : ''}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <TextField
                  label="Quantity received"
                  name={`${prefix}.quantityReceived`}
                  type="number"
                  min={0}
                  required
                  value={draft.received}
                  onChange={(event) => update(line.id, { received: event.target.value })}
                />
                <TextField
                  label="Quantity accepted"
                  name={`${prefix}.quantityAccepted`}
                  type="number"
                  min={0}
                  max={Math.min(received, line.outstandingQuantity)}
                  required
                  value={draft.accepted}
                  onChange={(event) => update(line.id, { accepted: event.target.value })}
                />
                <div>
                  <span className="block text-[12px] font-semibold text-ink-900">Quantity rejected</span>
                  <p className="mt-1 h-9 border border-ink-200 bg-ink-50 px-2 py-2 text-[13px] tabular" aria-live="polite">
                    {rejected}
                  </p>
                </div>
              </div>
              {rejected > 0 ? (
                <TextField label="Rejection reason" name={`${prefix}.rejectReason`} required />
              ) : null}
              <TextField label="Item remarks / condition" name={`${prefix}.conditionNotes`} />
              {line.stockItem || line.asset ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <TextField label="Batch code" name={`${prefix}.batchCode`} hint="Optional for batch-tracked stock." />
                  <TextField
                    label="Serial numbers"
                    name={`${prefix}.serialCodes`}
                    hint="Optional. Comma-separated when serial-tracked."
                  />
                </div>
              ) : null}
              {line.secondBatchDueOn ? (
                <p className="text-[12px] text-ink-700">
                  Second-batch date locked: {line.secondBatchDueOn}. Only the MD can correct it.
                </p>
              ) : staysShort && received > 0 ? (
                <TextField
                  label="Second-batch date for the remainder"
                  name={`${prefix}.secondBatchDueOn`}
                  type="date"
                  required
                  defaultValue={today}
                  hint="Required while any quantity stays outstanding after this delivery."
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <Button type="submit" variant="primary" disabled={needsWarehouse && warehouses.length === 0}>
        Record delivery
      </Button>
    </form>
  );
}

function CloseShortForm({ request }: { request: ProcurementView }) {
  const [state, formAction] = useToastAction(requestCloseShortAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={request.id} />
      {state.status === 'error' ? (
        <ErrorState title="Close-short was not sent" message={state.message} requestId={state.requestId} />
      ) : null}
      <TextField
        label={`Close short (${request.outstandingQuantity} outstanding)`}
        name="reason"
        required
      />
      <Button type="submit">Request close-short</Button>
    </form>
  );
}

export function ShortageOverrideForm({ request }: { request: ProcurementView }) {
  const locked = request.lines.filter((line) => line.secondBatchDueOn);
  const [state, formAction] = useToastAction(overrideShortageDeadlineAction);
  if (locked.length === 0) return null;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={request.id} />
      {state.status === 'error' ? (
        <ErrorState title="Date was not corrected" message={state.message} requestId={state.requestId} />
      ) : null}
      {locked.length > 1 ? (
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink-900">Line</span>
          <select name="lineId" className={CONTROL_CLASS} defaultValue={locked[0]?.id}>
            {locked.map((line) => (
              <option key={line.id} value={line.id}>
                Line {line.lineNumber}: {line.secondBatchDueOn}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="lineId" value={locked[0]?.id ?? ''} />
      )}
      <TextField
        label="Corrected second-batch date"
        name="dueOn"
        type="date"
        required
        defaultValue={locked[0]?.secondBatchDueOn ?? ''}
      />
      <TextField label="Reason" name="reason" required />
      <Button type="submit">Correct second-batch date</Button>
    </form>
  );
}

function CompleteForm({ request }: { request: ProcurementView }) {
  const [state, formAction] = useToastAction(completeDeliveryAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={request.id} />
      {state.status === 'error' ? (
        <ErrorState title="Could not complete" message={state.message} requestId={state.requestId} />
      ) : null}
      <Button type="submit" variant="primary">
        Complete procurement
      </Button>
    </form>
  );
}
