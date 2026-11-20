'use client';

import { useActionState, useEffect } from 'react';
import type { SalesOrderLineView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { useSetFormDirty } from '@/components/shell/FormDirty';
import { dispatchSalesAction } from '../actions';

export function DispatchForm({
  orderId,
  lines,
  today,
}: {
  orderId: string;
  lines: SalesOrderLineView[];
  today: string;
}) {
  const setDirty = useSetFormDirty();
  const [state, formAction] = useActionState(dispatchSalesAction, IDLE_ACTION_RESULT);

  useEffect(() => {
    setDirty(true);
    return () => setDirty(false);
  }, [setDirty]);

  return (
    <form action={formAction} className="space-y-3 px-4 py-4">
      <input type="hidden" name="id" value={orderId} />
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Destination</span>
        <input name="destination" required className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Vehicle</span>
        <input name="vehicle" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Driver</span>
        <input name="driver" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Date</span>
        <input
          name="occurredOn"
          type="date"
          required
          defaultValue={today}
          className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
        />
      </label>
      <div className="space-y-2">
        {lines.map((line) => {
          const remaining = line.quantity - line.dispatchedQty;
          return (
            <div key={line.id} className="border border-ink-200 px-3 py-2 text-[13px]">
              <input type="hidden" name="orderLineId" value={line.id} />
              <p className="font-medium">
                {line.itemCode} · {line.itemName}
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <label>
                  <span className="text-ink-500">Quantity (max {remaining})</span>
                  <input
                    name="quantity"
                    type="number"
                    required
                    min={0.0001}
                    max={remaining}
                    defaultValue={String(remaining)}
                    className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
                  />
                </label>
                <label>
                  <span className="text-ink-500">Batch</span>
                  <input name="batchCode" className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      {state.status === 'error' ? <p className="text-[13px] text-danger-700">{state.message}</p> : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <Button type="submit" variant="primary">
        Confirm Dispatch
      </Button>
    </form>
  );
}
