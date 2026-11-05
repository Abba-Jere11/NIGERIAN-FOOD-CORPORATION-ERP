'use client';

import { useMemo, useState } from 'react';
import type { ProcurementQuotationView, ProcurementView, VendorListItemView } from '@nfc/shared';
import { VENDOR_SELECTABLE_STATUSES, formatKobo, multiplyKoboByQuantity } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { DraftVersionInput, useDraftVersion } from '@/components/forms/DraftVersion';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ErrorState } from '@/components/ui/States';
import { attachQuotationAction, removeQuotationAction, selectQuotedVendorAction } from './actions';

/**
 * Vendor quotations side by side. The lowest quoted total is recommended; the
 * Procurement Manager awards the order to one quoted vendor and must justify
 * choosing any vendor that is not the lowest.
 */
export function QuotationComparison({
  request,
  vendors,
  editable,
}: {
  request: ProcurementView;
  vendors: VendorListItemView[];
  editable: boolean;
}) {
  const comparison = request.quotationComparison;
  const priced = request.quotations.filter((quote) => quote.vendorId && quote.amountKobo !== null);
  const legacy = request.quotations.filter((quote) => !quote.vendorId || quote.amountKobo === null);
  const recommended = priced.filter((quote) => quote.isLowest);
  const selected = priced.find((quote) => quote.vendorId === comparison.selectedVendorId) ?? null;
  const remaining = Math.max(comparison.minimumQuotations - comparison.pricedCount, 0);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-700" data-testid="quotation-progress">
        {comparison.pricedCount} of at least {comparison.minimumQuotations} vendor quotations recorded
        {remaining > 0 ? ` · add ${remaining} more before submitting` : ''}.
      </p>

      {priced.length === 0 ? (
        <p className="text-[13px] text-ink-600">No priced quotations yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="quotation-comparison">
            <thead>
              <tr className="border-b border-ink-200 text-[12px] text-ink-600">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Vendor</th>
                <th className="py-1 pr-2">Items</th>
                <th className="py-1 pr-2 text-right">Quoted total</th>
                <th className="py-1 pr-2">Quotation</th>
                <th className="py-1 pr-2">Status</th>
                {editable ? <th className="py-1">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {priced.map((quote, index) => (
                <QuotationRow
                  key={quote.id}
                  index={index}
                  quote={quote}
                  requestId={request.id}
                  rowVersion={request.rowVersion}
                  isSelected={quote.vendorId === comparison.selectedVendorId}
                  editable={editable}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recommended.length > 0 ? (
        <div className="border-l-2 border-accent-700 bg-accent-50 px-3 py-2 text-[13px]" data-testid="quotation-recommendation">
          <p className="font-medium text-ink-900">
            Recommendation (best price): {recommended.map((quote) => quote.vendorName).join(', ')} at{' '}
            {formatKobo(BigInt(recommended[0]!.amountKobo!))}
          </p>
          <p className="text-ink-700">
            {selected
              ? comparison.selectionIsRecommended
                ? `Selected: ${selected.vendorName}, the recommended vendor.`
                : `Selected: ${selected.vendorName} at ${formatKobo(BigInt(selected.amountKobo!))}, not the lowest price.`
              : 'No vendor selected yet. Review the comparison and select the vendor to award.'}
          </p>
          {comparison.selectionJustification ? (
            <p className="mt-1 text-ink-700">Justification: {comparison.selectionJustification}</p>
          ) : null}
        </div>
      ) : null}

      {legacy.length > 0 ? (
        <div className="text-[12px] text-ink-600">
          <p className="font-semibold">Earlier attachments without a vendor or price</p>
          <ul>
            {legacy.map((quote) => (
              <li key={quote.id}>
                <a className="underline" href={`/documents/${quote.documentId}`}>
                  {quote.referenceNumber ?? quote.title ?? 'Quotation'}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!editable && request.priceComparison ? (
        <p className="text-[13px] text-ink-700">Earlier price comparison note: {request.priceComparison}</p>
      ) : null}

      {editable ? <AddQuotationForm request={request} vendors={vendors} /> : null}
    </div>
  );
}

function QuotationRow({
  index,
  quote,
  requestId,
  rowVersion,
  isSelected,
  editable,
}: {
  index: number;
  quote: ProcurementQuotationView;
  requestId: string;
  rowVersion: number;
  isSelected: boolean;
  editable: boolean;
}) {
  const draft = useDraftVersion();
  const [justifying, setJustifying] = useState(false);
  const [selectState, selectAction, selecting] = useToastAction(selectQuotedVendorAction, {
    errorTitle: 'The vendor was not selected',
    onSuccess: (result) => {
      draft?.advance(result.rowVersion);
      setJustifying(false);
    },
  });
  const [, removeAction, removing] = useToastAction(removeQuotationAction, {
    errorTitle: 'The quotation was not removed',
    onSuccess: (result) => draft?.advance(result.rowVersion),
  });

  return (
    <>
      <tr className="border-b border-ink-100 align-top" data-testid="quotation-row">
        <td className="py-1.5 pr-2">{index + 1}</td>
        <td className="py-1.5 pr-2">
          <span className="font-medium text-ink-900">{quote.vendorName}</span>
          {quote.vendorReference ? <span className="block text-[12px] text-ink-500">{quote.vendorReference}</span> : null}
          {quote.notes ? <span className="block text-[12px] text-ink-600">{quote.notes}</span> : null}
        </td>
        <td className="py-1.5 pr-2">
          <QuotationItems quote={quote} />
        </td>
        <td className="tabular py-1.5 pr-2 text-right">{formatKobo(BigInt(quote.amountKobo!))}</td>
        <td className="py-1.5 pr-2">
          <a className="underline" href={`/documents/${quote.documentId}`}>
            {quote.referenceNumber ?? 'View'}
          </a>
        </td>
        <td className="py-1.5 pr-2">
          <span className="flex flex-wrap gap-1">
            {quote.isLowest ? (
              <span className="border border-accent-700 bg-accent-50 px-1.5 text-[11px] font-semibold text-accent-900">
                Best price · recommended
              </span>
            ) : null}
            {isSelected ? (
              <span className="border border-ink-400 bg-surface-muted px-1.5 text-[11px] font-semibold text-ink-900">
                Selected
              </span>
            ) : null}
          </span>
        </td>
        {editable ? (
          <td className="py-1.5">
            <div className="flex flex-wrap gap-1">
              {!isSelected ? (
                quote.isLowest ? (
                  <form action={selectAction}>
                    <input type="hidden" name="id" value={requestId} />
                    <input type="hidden" name="vendorId" value={quote.vendorId ?? ''} />
                    <DraftVersionInput fallback={rowVersion} />
                    <Button type="submit" size="sm" variant="primary" disabled={selecting}>
                      Select vendor
                    </Button>
                  </form>
                ) : (
                  <Button type="button" size="sm" onClick={() => setJustifying((current) => !current)}>
                    Select vendor
                  </Button>
                )
              ) : null}
              <form
                action={removeAction}
                onSubmit={(event) => {
                  if (!window.confirm(`Remove the quotation from ${quote.vendorName ?? 'this vendor'}?`)) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="id" value={requestId} />
                <input type="hidden" name="quotationId" value={quote.id} />
                <Button type="submit" size="sm" variant="subtle" disabled={removing}>
                  Remove
                </Button>
              </form>
            </div>
          </td>
        ) : null}
      </tr>
      {editable && justifying ? (
        <tr className="border-b border-ink-100">
          <td colSpan={7} className="py-2">
            <form action={selectAction} className="space-y-2 border border-warning-600 bg-warning-100 px-3 py-2">
              <input type="hidden" name="id" value={requestId} />
              <input type="hidden" name="vendorId" value={quote.vendorId ?? ''} />
              <DraftVersionInput fallback={rowVersion} />
              {selectState.status === 'error' ? (
                <ErrorState title="The vendor was not selected" message={selectState.message} requestId={selectState.requestId} />
              ) : null}
              <TextAreaField
                label={`Why award to ${quote.vendorName ?? 'this vendor'} instead of the lowest price?`}
                name="justification"
                required
                minLength={10}
                hint="Shown on the memo to every approver."
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="primary" disabled={selecting}>
                  Select with justification
                </Button>
                <Button type="button" size="sm" onClick={() => setJustifying(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AddQuotationForm({ request, vendors }: { request: ProcurementView; vendors: VendorListItemView[] }) {
  const [generation, setGeneration] = useState(0);
  return (
    <AddQuotationFields
      key={generation}
      request={request}
      vendors={vendors}
      onAdded={() => setGeneration((current) => current + 1)}
    />
  );
}

function AddQuotationFields({
  request,
  vendors,
  onAdded,
}: {
  request: ProcurementView;
  vendors: VendorListItemView[];
  onAdded: () => void;
}) {
  const draft = useDraftVersion();
  const [state, formAction, pending] = useToastAction(attachQuotationAction, {
    errorTitle: 'Quotation was not added',
    onSuccess: (result) => {
      draft?.advance(result.rowVersion);
      onAdded();
    },
  });
  const quotedVendorIds = new Set(request.quotations.map((quote) => quote.vendorId).filter(Boolean));
  const items = (request.lines ?? []).filter((line) => line.quantity > 0);
  const available = vendors.filter(
    (vendor) =>
      (VENDOR_SELECTABLE_STATUSES as readonly string[]).includes(vendor.status) &&
      !vendor.complianceExpired &&
      !quotedVendorIds.has(vendor.id),
  );

  return (
    <form action={formAction} className="space-y-3 border border-ink-200 bg-surface-muted px-3 py-3">
      <p className="text-[13px] font-semibold text-ink-900">Add a vendor quotation</p>
      <input type="hidden" name="id" value={request.id} />
      {state.status === 'error' ? (
        <ErrorState title="Quotation was not added" message={state.message} requestId={state.requestId} />
      ) : null}
      {available.length === 0 ? (
        <p className="text-[13px] text-ink-600">
          Every active registered vendor already has a quotation here. Register or reactivate vendors in Vendor
          Management to compare more prices.
        </p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-600">Add the items and quantities on the memo before recording a quotation.</p>
      ) : (
        <>
          <SelectField
            label="Vendor (active registered vendors)"
            name="vendorId"
            required
            defaultValue=""
            placeholder="Select a vendor"
            options={available.map((vendor) => ({
              value: vendor.id,
              label: `${vendor.legalName} (${vendor.referenceNumber})`,
            }))}
          />
          <QuotationItemPrices request={request} />
          <label className="block">
            <span className="block text-[12px] font-semibold text-ink-700">
              Quotation document
              <span className="ml-0.5 text-danger-600" aria-hidden="true">
                *
              </span>
            </span>
            <input
              name="file"
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="mt-1 block w-full border border-ink-300 bg-surface px-3 py-2 text-[13px]"
            />
          </label>
          <TextField label="Notes (optional)" name="notes" hint="Delivery terms, validity, warranty." />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Adding…' : 'Add quotation'}
          </Button>
        </>
      )}
    </form>
  );
}

function QuotationItems({ quote }: { quote: ProcurementQuotationView }) {
  const lines = quote.lines ?? [];
  if (lines.length === 0) {
    return (
      <span className="tabular">
        {quote.unitPriceKobo != null && quote.unitPriceKobo > 0 ? formatKobo(BigInt(quote.unitPriceKobo)) : '—'}
      </span>
    );
  }
  return (
    <ul className="space-y-1" data-testid="quotation-line-prices">
      {lines.map((line) => (
        <li key={line.lineNumber} className="text-[12px] text-ink-800">
          <span className="font-medium">{line.description || `Item ${line.lineNumber}`}</span>
          <span className="tabular block text-ink-600">
            {formatKobo(BigInt(line.unitPriceKobo))} × {line.quantity}
            {line.unitCode ? ` ${line.unitCode}` : ''} = {formatKobo(BigInt(line.lineAmountKobo))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function QuotationItemPrices({ request }: { request: ProcurementView }) {
  const items = (request.lines ?? []).filter((line) => line.quantity > 0);
  const [prices, setPrices] = useState<Record<number, bigint | null>>({});
  const total = useMemo(() => {
    let sum = 0n;
    let any = false;
    for (const line of items) {
      const price = prices[line.lineNumber];
      if (price === undefined || price === null || price <= 0n) continue;
      any = true;
      sum += multiplyKoboByQuantity(price, line.quantity);
    }
    return any ? sum : null;
  }, [items, prices]);

  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold text-ink-900">Unit price for each item</p>
      {items.map((line, index) => (
        <div key={line.id}>
          <input type="hidden" name={`lines[${index}].lineNumber`} value={line.lineNumber} />
          <MoneyInput
            label={`${line.lineNumber}. ${line.description || line.categoryName || 'Item'} · ${line.quantity} ${line.unitCode ?? ''}`.trim()}
            name={`lines[${index}].unitPriceKobo`}
            required
            onKoboChange={(value) => setPrices((current) => ({ ...current, [line.lineNumber]: value }))}
          />
        </div>
      ))}
      <p className="text-[13px] text-ink-700" data-testid="quotation-total-preview">
        Vendor total: {total === null ? '—' : formatKobo(total)}
      </p>
    </div>
  );
}
