'use client';

import type { BankAccountView, ProcurementView } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { Button } from '@/components/ui/Button';
import { CONTROL_CLASS, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { recordTransferAction } from './actions';

export function TransferForm({
  request,
  accounts,
}: {
  request: ProcurementView;
  accounts: BankAccountView[];
}) {
  const [state, formAction, pending] = useToastAction(recordTransferAction, {
    errorTitle: 'Transfer was not recorded',
  });
  const nfc = accounts.filter((row) => row.entityCode === 'NFC');
  const dest = accounts.filter((row) => row.entityId === request.entityId);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="amountKobo" value={String(request.authorizedAmountKobo ?? 0)} />
      {state.status === 'error' ? (
        <ErrorState title="Transfer was not recorded" message={state.message} requestId={state.requestId} />
      ) : null}
      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">NFC source account</span>
        <select name="sourceAccountId" required className={CONTROL_CLASS} defaultValue={request.payingAccountId ?? ''}>
          {nfc.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.accountNumberMasked}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">Subsidiary destination</span>
        <select
          name="destinationAccountId"
          required
          className={CONTROL_CLASS}
          defaultValue={request.destinationAccountId ?? ''}
        >
          {dest.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.accountNumberMasked}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Purpose" name="purpose" required defaultValue={`Allocation for ${request.referenceNumber}`} />
      <TextField label="Transfer date" name="transferDate" type="date" required />
      <TextField label="Method" name="transferMethod" required defaultValue="bank_transfer" />
      <TextField label="Bank / reference number" name="bankReference" required />
      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">Proof of transfer</span>
        <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png" className="mt-1 block w-full text-[13px]" />
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Recording…' : 'Record transfer'}
      </Button>
    </form>
  );
}
