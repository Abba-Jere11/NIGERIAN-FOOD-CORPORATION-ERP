'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import type { StockIssueView, SupplierReturnableLineView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { IDLE_ACTION_RESULT, type ActionResult } from '@/lib/action-result';
import { useSetFormDirty } from '@/components/shell/FormDirty';
import { TransactionReview } from './DeskWidgets';

export function ReceiveReturnForm({
  action,
  entityId,
  issues,
  today,
}: {
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  entityId: string;
  issues: StockIssueView[];
  today: string;
}) {
  const setDirty = useSetFormDirty();
  const [state, formAction] = useActionState(action, IDLE_ACTION_RESULT);
  const open = issues.filter((row) => row.status === 'POSTED' && row.lines.some((line) => line.remainingQty > 0));
  const [issueId, setIssueId] = useState('');
  const issue = open.find((row) => row.id === issueId) ?? null;
  const [lineId, setLineId] = useState('');
  const line = issue?.lines.find((row) => row.id === lineId) ?? null;

  useEffect(() => {
    setDirty(true);
    return () => setDirty(false);
  }, [setDirty]);

  return (
    <form action={formAction} className="space-y-3 px-4 py-4">
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="kind" value="RECEIVE_RETURN" />
      <input type="hidden" name="issueId" value={issueId} />
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Original issue</span>
        <select
          required
          value={issueId}
          onChange={(event) => {
            setIssueId(event.target.value);
            setLineId('');
          }}
          className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5"
        >
          <option value="">Select an issue</option>
          {open.map((row) => (
            <option key={row.id} value={row.id}>
              {row.referenceNumber} · {row.warehouseName}
            </option>
          ))}
        </select>
      </label>
      {issue ? (
        <label className="block text-[13px]">
          <span className="font-semibold text-ink-700">Line</span>
          <select
            name="issueLineId"
            required
            value={lineId}
            onChange={(event) => setLineId(event.target.value)}
            className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5"
          >
            <option value="">Select a line</option>
            {issue.lines
              .filter((row) => row.remainingQty > 0)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.itemCode} — {row.remainingQty} of {row.quantity} still returnable
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {line ? <input type="hidden" name="itemId" value={line.itemId} /> : null}
      {issue ? (
        <input
          type="hidden"
          name="warehouseId"
          value={
            // warehouse is on the issue header; the API uses the form warehouse id.
            ''
          }
        />
      ) : null}
      <IssueWarehouseField issue={issue} />
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Quantity</span>
        <input
          name="quantity"
          type="number"
          required
          min={0.0001}
          max={line?.remainingQty}
          defaultValue={line?.remainingQty ? String(line.remainingQty) : ''}
          className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
        />
        {line ? <p className="mt-1 text-[12px] text-ink-600">Maximum {line.remainingQty}.</p> : null}
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Returned from (department)</span>
        <input name="departmentLabel" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Returned by</span>
        <input name="returnedByName" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Reason</span>
        <input name="reason" required className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Date</span>
        <input name="occurredOn" type="date" required defaultValue={today} className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <TransactionReview>
        {line
          ? `Return ${line.itemCode} against ${issue?.referenceNumber}. Stock lands in quarantine.`
          : 'Choose the original issue line.'}
      </TransactionReview>
      {state.status === 'error' ? <p className="text-[13px] text-danger-700">{state.message}</p> : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <Button type="submit" variant="primary">
        Receive into quarantine
      </Button>
    </form>
  );
}

function IssueWarehouseField({ issue }: { issue: StockIssueView | null }) {
  if (!issue?.warehouseId) return null;
  return <input type="hidden" name="warehouseId" value={issue.warehouseId} />;
}

export function SupplierReturnForm({
  action,
  entityId,
  lines,
  today,
}: {
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  entityId: string;
  lines: SupplierReturnableLineView[];
  today: string;
}) {
  const setDirty = useSetFormDirty();
  const [state, formAction] = useActionState(action, IDLE_ACTION_RESULT);
  const [key, setKey] = useState('');
  const selected = useMemo(
    () => lines.find((row) => lineKey(row) === key) ?? null,
    [lines, key],
  );

  useEffect(() => {
    setDirty(true);
    return () => setDirty(false);
  }, [setDirty]);

  return (
    <form action={formAction} className="space-y-3 px-4 py-4">
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="kind" value="SUPPLIER_RETURN" />
      {selected ? (
        <>
          <input type="hidden" name="warehouseId" value={selected.warehouseId} />
          <input type="hidden" name="itemId" value={selected.itemId} />
          <input type="hidden" name="fromStatus" value={selected.fromStatus} />
          {selected.vendorId ? <input type="hidden" name="vendorId" value={selected.vendorId} /> : null}
          {selected.grnId ? <input type="hidden" name="grnId" value={selected.grnId} /> : null}
          {selected.batchCode ? <input type="hidden" name="batchCode" value={selected.batchCode} /> : null}
          {selected.serialCode ? <input type="hidden" name="serialCode" value={selected.serialCode} /> : null}
        </>
      ) : null}
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Eligible stock</span>
        <select
          required
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5"
        >
          <option value="">Select quarantined or rejected stock</option>
          {lines.map((row) => (
            <option key={lineKey(row)} value={lineKey(row)}>
              {row.itemCode} · {row.warehouseName} · {row.fromStatus.toLowerCase()} · {row.remainingQty} {row.uomCode}
              {row.grnReference ? ` · ${row.grnReference}` : ''}
              {row.batchCode ? ` · ${row.batchCode}` : ''}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <p className="text-[12px] text-ink-600">
          {selected.vendorName ? `Supplier ${selected.vendorName}. ` : 'Choose the supplier if it is not known. '}
          Maximum returnable {selected.remainingQty} {selected.uomCode} at {selected.warehouseName}.
        </p>
      ) : null}
      {!selected?.vendorId ? (
        <label className="block text-[13px]">
          <span className="font-semibold text-ink-700">Supplier</span>
          <input name="vendorId" required={Boolean(selected)} className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
        </label>
      ) : null}
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Quantity</span>
        <input
          name="quantity"
          type="number"
          required
          min={0.0001}
          max={selected?.remainingQty}
          className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
        />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Reason</span>
        <input name="reason" required className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Date</span>
        <input name="occurredOn" type="date" required defaultValue={today} className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <TransactionReview>
        {selected
          ? `Return ${selected.itemCode} (${selected.fromStatus.toLowerCase()}) to ${selected.vendorName ?? 'the supplier'}${
              selected.grnReference ? ` against ${selected.grnReference}` : ''
            }.`
          : 'Select eligible stock to review the return.'}
      </TransactionReview>
      {state.status === 'error' ? <p className="text-[13px] text-danger-700">{state.message}</p> : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <Button type="submit" variant="primary">
        Return to supplier
      </Button>
    </form>
  );
}

function lineKey(row: SupplierReturnableLineView): string {
  return [row.itemId, row.warehouseId, row.fromStatus, row.batchId ?? '', row.serialId ?? '', row.grnId ?? ''].join(':');
}
