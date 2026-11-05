'use client';

import type { BankAccountView, ProcurementView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { Button } from '@/components/ui/Button';
import { CONTROL_CLASS } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ErrorState } from '@/components/ui/States';
import { completePaymentAction } from './actions';

export function PaymentForm({
  request,
  accounts,
}: {
  request: ProcurementView;
  accounts: BankAccountView[];
}) {
  const [state, formAction, pending] = useToastAction(completePaymentAction, {
    errorTitle: 'Payment was not recorded',
  });
  const paying =
    request.fundingRoute === 'nfc_holding'
      ? accounts.filter((row) => row.entityCode === 'NFC')
      : accounts.filter((row) => row.entityId === request.entityId);
  const vendorStatus = request.vendorStatus;
  if (vendorStatus !== null && vendorStatus !== undefined && vendorStatus !== 'ACTIVE') {
    return (
      <p role="status" className="text-[13px] text-ink-800">
        Payment is blocked because the vendor is {vendorStatus.toLowerCase().replaceAll('_', ' ')}.
        Restore the vendor to Active before recording payment.
      </p>
    );
  }

  const payable = request.payableAmountKobo;
  const authorized = request.authorizedAmountKobo ?? 0;
  const paid = request.paidAmountKobo;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={request.id} />
      <input type="hidden" name="idempotencyKey" value={`web-pay-${request.id}-${request.rowVersion}`} />
      {state.status === 'error' ? (
        <ErrorState title="Payment was not recorded" message={state.message} requestId={state.requestId} />
      ) : null}
      <p className="text-[13px] text-ink-700">
        Authorized {formatKobo(BigInt(authorized))}. Paid {formatKobo(BigInt(paid))}. Payable{' '}
        {formatKobo(BigInt(payable))}.
      </p>
      <p className="text-[13px]">
        Vendor bank: {request.vendorBankName ?? '—'} · {request.vendorAccountName ?? '—'} ·{' '}
        {request.vendorAccountNumber ?? '—'}
      </p>
      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">Paying account</span>
        <select
          name="payingAccountId"
          className={CONTROL_CLASS}
          defaultValue={request.payingAccountId ?? paying[0]?.id ?? ''}
        >
          {paying.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.accountNumberMasked}
            </option>
          ))}
        </select>
      </label>
      <MoneyInput
        key={payable}
        label="Amount"
        name="amountKobo"
        required
        defaultKobo={String(payable)}
        hint="Defaults to the payable amount. A smaller positive amount records a part payment."
      />
      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">Payment proof (optional)</span>
        <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="mt-1 block w-full text-[13px]" />
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Recording…' : 'Record vendor payment'}
      </Button>
    </form>
  );
}
