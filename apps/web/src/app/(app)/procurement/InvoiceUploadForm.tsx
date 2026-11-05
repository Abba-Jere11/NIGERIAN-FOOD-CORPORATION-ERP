'use client';

import { useState } from 'react';
import { useToastAction } from '@/lib/use-toast-action';
import { useDraftVersion } from '@/components/forms/DraftVersion';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ErrorState } from '@/components/ui/States';
import { attachInvoiceAction } from './actions';

export function InvoiceUploadForm({
  requestId,
  replacing = false,
  vendor,
}: {
  requestId: string;
  replacing?: boolean;
  /** At ED Finance the invoice must come from the approved vendor, shown read-only. */
  vendor?: { id: string; name: string | null };
}) {
  // Remounting after a successful upload clears the file and fields for the next one.
  const [generation, setGeneration] = useState(0);
  return (
    <InvoiceUploadFields
      key={generation}
      requestId={requestId}
      replacing={replacing}
      vendor={vendor}
      onAttached={() => setGeneration((current) => current + 1)}
    />
  );
}

function InvoiceUploadFields({
  requestId,
  replacing,
  vendor,
  onAttached,
}: {
  requestId: string;
  replacing: boolean;
  vendor?: { id: string; name: string | null };
  onAttached: () => void;
}) {
  const draft = useDraftVersion();
  const [state, formAction, pending] = useToastAction(attachInvoiceAction, {
    errorTitle: 'Invoice was not attached',
    onSuccess: (result) => {
      draft?.advance(result.rowVersion);
      onAttached();
    },
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const attached = Boolean(fileName);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={requestId} />
      {vendor ? <input type="hidden" name="vendorId" value={vendor.id} /> : null}
      {state.status === 'error' ? (
        <ErrorState title="Invoice was not attached" message={state.message} requestId={state.requestId} />
      ) : null}
      {vendor ? (
        <p className="text-[13px] text-ink-700">
          Issued by: <span className="font-medium text-ink-900">{vendor.name ?? 'the approved vendor'}</span>. Only an
          invoice from the approved vendor is accepted.
        </p>
      ) : null}

      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">
          {replacing ? 'Replace invoice file' : 'Attach invoice file'}
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-500">PDF, JPG or PNG. This is the primary step.</span>
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="mt-2 block w-full border border-ink-300 bg-surface px-3 py-3 text-[13px]"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        />
      </label>

      {attached ? (
        <div className="flex flex-wrap items-end gap-2 border border-ink-200 bg-surface-muted px-2 py-2">
          <p className="min-w-[8rem] flex-1 truncate text-[12px] text-ink-700" title={fileName ?? undefined}>
            {fileName}
          </p>
          <label className="min-w-[7rem] flex-1">
            <span className="sr-only">Invoice number</span>
            <input
              name="invoiceNumber"
              required
              placeholder="Number"
              className="block w-full border border-ink-300 bg-surface px-2 py-1 text-[13px] text-ink-900"
            />
          </label>
          <label className="min-w-[8rem]">
            <span className="sr-only">Invoice date</span>
            <input
              name="invoiceDate"
              type="date"
              required
              className="block w-full border border-ink-300 bg-surface px-2 py-1 text-[13px] text-ink-900"
            />
          </label>
          <div className="min-w-[8rem] flex-1">
            <MoneyInput name="amountKobo" label="Invoice amount" required compact />
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <TextField label="Invoice number" name="invoiceNumber" required />
          <TextField label="Invoice date" name="invoiceDate" type="date" required />
          <MoneyInput label="Invoice amount" name="amountKobo" required hideWords />
        </div>
      )}

      {replacing ? <TextField label="Replacement reason" name="reason" required /> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Attaching…' : replacing ? 'Replace invoice' : 'Attach invoice'}
      </Button>
    </form>
  );
}
