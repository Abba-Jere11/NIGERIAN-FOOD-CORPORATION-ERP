'use client';

import { useActionState, useEffect, useMemo, useState, type ReactNode } from 'react';
import { INTEGER_UOM_CODES, type InventoryItemListView, type StockBatchListView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { IDLE_ACTION_RESULT, type ActionResult } from '@/lib/action-result';
import { useSetFormDirty } from '@/components/shell/FormDirty';
import { fetchWarehouseItems, fetchBatches } from '../picker-actions';

const INTEGER = new Set<string>(INTEGER_UOM_CODES);

export function ItemPicker({
  items,
  value,
  onChange,
  outbound,
}: {
  items: InventoryItemListView[];
  value: string;
  onChange: (item: InventoryItemListView | null) => void;
  outbound?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = items.filter((item) => {
    const hay = `${item.code} ${item.name}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });
  return (
    <label className="block text-[13px]">
      <span className="font-semibold text-ink-700">Item</span>
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search name or code"
        className="mt-1 mb-1 block w-full border border-ink-300 px-2 py-1.5"
      />
      <select
        name="itemId"
        required
        value={value}
        onChange={(event) => onChange(items.find((item) => item.id === event.target.value) ?? null)}
        className="block w-full border border-ink-300 bg-surface px-2 py-1.5"
      >
        <option value="">Select an item</option>
        {filtered.map((item) => {
          const out = outbound && item.availableQty <= 0;
          return (
            <option key={item.id} value={item.id} disabled={out}>
              {item.name} / {item.code} — {out ? 'Out of stock' : `${item.availableQty} ${item.uomCode} available`}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function QuantityField({
  max,
  uom,
  value,
  onChange,
}: {
  max: number | null;
  uom: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const numeric = Number(value);
  const integer = INTEGER.has(uom);
  const over = max != null && Number.isFinite(numeric) && numeric > max + 1e-9;
  const bad = value !== '' && (numeric <= 0 || (integer && !Number.isInteger(numeric)));
  return (
    <label className="block text-[13px]">
      <span className="font-semibold text-ink-700">Quantity{uom ? ` (${uom})` : ''}</span>
      <input
        name="quantity"
        type="number"
        required
        min={integer ? 1 : 0.0001}
        step={integer ? 1 : 'any'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full border border-ink-300 px-2 py-1.5"
      />
      {bad ? <p className="mt-1 text-danger-700">Enter a valid quantity.</p> : null}
      {over ? (
        <p className="mt-1 text-danger-700">
          Only {max} {uom} are available in this warehouse.
        </p>
      ) : null}
    </label>
  );
}

export function TrackingFields({
  item,
  batches,
  warehouseId,
}: {
  item: InventoryItemListView | null;
  batches: StockBatchListView[];
  warehouseId: string;
}) {
  if (!item || item.trackingMode === 'none') return null;
  if (item.trackingMode === 'serial') {
    return (
      <label className="block text-[13px]">
        <span className="font-semibold text-ink-700">Serial</span>
        <input name="serialCode" required className="mt-1 block w-full border border-ink-300 px-2 py-1.5" />
      </label>
    );
  }
  // FEFO: earliest expires_on first among eligible batches; undated last.
  const options = batches
    .filter((batch) => batch.itemId === item.id && batch.warehouseId === warehouseId)
    .filter((batch) => batch.qty > 0)
    .slice()
    .sort((a, b) => {
      if (!a.expiresOn && !b.expiresOn) return a.batchCode.localeCompare(b.batchCode);
      if (!a.expiresOn) return 1;
      if (!b.expiresOn) return -1;
      return a.expiresOn.localeCompare(b.expiresOn) || a.batchCode.localeCompare(b.batchCode);
    });
  return (
    <label className="block text-[13px]">
      <span className="font-semibold text-ink-700">Batch</span>
      <select name="batchCode" required className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5">
        <option value="">Select a batch</option>
        {options.map((batch) => {
          const expired = batch.expiryStatus === 'expired';
          const expiry = batch.expiresOn
            ? expired
              ? `expired ${batch.expiresOn}`
              : `exp ${batch.expiresOn}`
            : 'no expiry date';
          return (
            <option key={batch.id} value={batch.batchCode} disabled={expired}>
              {batch.batchCode} — {batch.qty} · {expiry}
              {expired ? ' (blocked)' : ''}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function StockEffectPreview({
  available,
  quantity,
  uom,
  transfer,
}: {
  available: number | null;
  quantity: number;
  uom: string;
  transfer?: { from: string; to: string };
}) {
  if (available == null || !quantity) return null;
  const remaining = available - quantity;
  return (
    <p className="text-[12px] text-ink-600">
      {transfer
        ? `${transfer.from}: ${available} → ${remaining} ${uom}. ${transfer.to}: +${quantity} ${uom}.`
        : `Remaining after this movement: ${remaining} ${uom}.`}
    </p>
  );
}

export function TransactionReview({ children }: { children: ReactNode }) {
  return <div className="border border-ink-200 bg-ink-50 px-3 py-2 text-[13px] text-ink-800">{children}</div>;
}

export function WarehouseSelect({
  warehouses,
  value,
  onChange,
  name = 'warehouseId',
  label = 'Warehouse',
}: {
  warehouses: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  name?: string;
  label?: string;
}) {
  return (
    <label className="block text-[13px]">
      <span className="font-semibold text-ink-700">{label}</span>
      <select
        name={name}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5"
      >
        <option value="">Select a warehouse</option>
        {warehouses.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export type SmartStockReviewKind = 'issue' | 'transfer';

function StockReviewCopy({
  kind,
  item,
  qty,
  warehouseName,
}: {
  kind: SmartStockReviewKind;
  item: InventoryItemListView | null;
  qty: number;
  warehouseName: string;
}) {
  if (!item) {
    return kind === 'issue' ? (
      <>Choose a warehouse and item to review this issue.</>
    ) : (
      <>Choose source warehouse and item.</>
    );
  }
  if (kind === 'issue') {
    return (
      <>
        Issue {qty} {item.uomCode} of {item.code} from {warehouseName || 'the selected warehouse'}.
      </>
    );
  }
  return (
    <>
      Transfer {qty} {item.uomCode} of {item.code} from {warehouseName || 'source'} to the destination store (same
      subsidiary).
    </>
  );
}

export function SmartStockForm({
  action,
  entityId,
  warehouses,
  submitLabel,
  outbound = true,
  extraFields,
  hidden,
  reviewKind,
  allowZeroStock,
  warehouseFieldName = 'warehouseId',
  warehouseLabel = 'Warehouse',
}: {
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  entityId: string;
  warehouses: Array<{ id: string; name: string }>;
  submitLabel: string;
  outbound?: boolean;
  extraFields?: ReactNode;
  hidden?: ReactNode;
  /** Serializable kind so Server Components never pass a review callback. */
  reviewKind: SmartStockReviewKind;
  allowZeroStock?: boolean;
  warehouseFieldName?: string;
  warehouseLabel?: string;
}) {
  const setDirty = useSetFormDirty();
  const [state, formAction] = useActionState(action, IDLE_ACTION_RESULT);
  const [warehouseId, setWarehouseId] = useState('');
  const [items, setItems] = useState<InventoryItemListView[]>([]);
  const [batches, setBatches] = useState<StockBatchListView[]>([]);
  const [item, setItem] = useState<InventoryItemListView | null>(null);
  const [qty, setQty] = useState('');

  useEffect(() => {
    setDirty(true);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      setDirty(false);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [setDirty]);

  useEffect(() => {
    setItem(null);
    setQty('');
    if (!entityId || !warehouseId) {
      setItems([]);
      return;
    }
    void fetchWarehouseItems(entityId, warehouseId).then(setItems);
    void fetchBatches(entityId).then(setBatches);
  }, [entityId, warehouseId]);

  const warehouseName = warehouses.find((row) => row.id === warehouseId)?.name ?? '';
  const quantity = Number(qty) || 0;
  const cap = item ? (outbound ? item.availableQty : null) : null;
  const blocked =
    !item ||
    quantity <= 0 ||
    (cap != null && quantity > cap + 1e-9) ||
    (INTEGER.has(item.uomCode) && !Number.isInteger(quantity));

  const visibleItems = useMemo(
    () => (allowZeroStock ? items : items),
    [allowZeroStock, items],
  );

  return (
    <form action={formAction} className="space-y-3 px-4 py-4">
      <input type="hidden" name="entityId" value={entityId} />
      {hidden}
      <WarehouseSelect
        warehouses={warehouses}
        value={warehouseId}
        onChange={setWarehouseId}
        name={warehouseFieldName}
        label={warehouseLabel}
      />
      <ItemPicker
        items={visibleItems}
        value={item?.id ?? ''}
        onChange={setItem}
        outbound={outbound && !allowZeroStock}
      />
      <QuantityField max={cap} uom={item?.uomCode ?? ''} value={qty} onChange={setQty} />
      <TrackingFields item={item} batches={batches} warehouseId={warehouseId} />
      {extraFields}
      <StockEffectPreview available={item?.availableQty ?? null} quantity={quantity} uom={item?.uomCode ?? ''} />
      <TransactionReview>
        <StockReviewCopy kind={reviewKind} item={item} qty={quantity} warehouseName={warehouseName} />
      </TransactionReview>
      {state.status === 'error' ? <p className="text-[13px] text-danger-700">{state.message}</p> : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <Button type="submit" variant="primary" disabled={blocked}>
        {submitLabel}
      </Button>
    </form>
  );
}
