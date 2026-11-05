'use client';

import { useMemo, useState } from 'react';
import type {
  BankAccountView,
  FinancialCheckView,
  PaymentTiming,
  WorkflowInstanceView,
} from '@nfc/shared';
import { FUNDING_ROUTE_LABELS, FUNDING_ROUTES, PAYMENT_TIMING_LABELS } from '@nfc/shared';
import { useToastAction } from '@/lib/use-toast-action';
import { Button } from '@/components/ui/Button';
import { CONTROL_CLASS, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { financeDecisionAction } from './actions';

export function FinanceDecisionForm({
  requestId,
  workflow,
  checks,
  accounts,
  suggestedRoute,
  finalPaymentTiming,
  timingChangePendingAck,
}: {
  requestId: string;
  workflow: WorkflowInstanceView;
  checks: FinancialCheckView[];
  accounts: BankAccountView[];
  suggestedRoute: string | null;
  finalPaymentTiming: PaymentTiming | null;
  timingChangePendingAck: boolean;
}) {
  const [state, formAction, pending] = useToastAction(financeDecisionAction, {
    errorTitle: 'Finance decision was refused',
  });
  const [route, setRoute] = useState(suggestedRoute && suggestedRoute in FUNDING_ROUTE_LABELS ? suggestedRoute : 'subsidiary_operating');
  const hasFail = checks.some((check) => check.result === 'FAIL');
  const nfcAccounts = useMemo(() => accounts.filter((row) => row.entityCode === 'NFC'), [accounts]);
  const subsidiaryAccounts = useMemo(() => accounts.filter((row) => row.entityCode !== 'NFC'), [accounts]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="rowVersion" value={workflow.rowVersion} />
      {state.status === 'error' ? (
        <ErrorState title="Finance decision was refused" message={state.message} requestId={state.requestId} />
      ) : null}
      <label className="block">
        <span className="block text-[12px] font-semibold text-ink-900">Funding route</span>
        <select
          name="fundingRoute"
          className={CONTROL_CLASS}
          value={route}
          onChange={(event) => setRoute(event.target.value)}
        >
          {FUNDING_ROUTES.map((key) => (
            <option key={key} value={key}>
              {FUNDING_ROUTE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {route === 'subsidiary_operating' ? (
        <AccountSelect name="sourceAccountId" label="Subsidiary paying account" accounts={subsidiaryAccounts} />
      ) : null}
      {route === 'nfc_holding' ? (
        <AccountSelect name="sourceAccountId" label="NFC paying account" accounts={nfcAccounts} />
      ) : null}
      {route === 'corporate_allocation' ? (
        <>
          <AccountSelect name="sourceAccountId" label="NFC source account" accounts={nfcAccounts} />
          <AccountSelect name="destinationAccountId" label="Subsidiary destination account" accounts={subsidiaryAccounts} />
        </>
      ) : null}

      <p className="text-[13px] text-ink-800">
        Payment timing:{' '}
        {finalPaymentTiming ? PAYMENT_TIMING_LABELS[finalPaymentTiming] : 'not set'}
      </p>
      {timingChangePendingAck ? (
        <label className="flex items-start gap-2 text-[13px] text-ink-800">
          <input type="checkbox" name="timingAcknowledged" required className="mt-1" />
          <span>I acknowledge the payment-timing decision</span>
        </label>
      ) : null}
      <label className="flex items-start gap-2 text-[13px] text-ink-800">
        <input type="checkbox" name="checklistAcknowledged" required className="mt-1" />
        <span>I have reviewed every check. Approving stores this snapshot with the decision.</span>
      </label>
      {hasFail ? (
        <TextField
          label="Override reason"
          name="overrideReason"
          required
          hint="Required because at least one check returned FAIL."
        />
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Approving…' : 'Approve funding'}
      </Button>
    </form>
  );
}

function AccountSelect({
  name,
  label,
  accounts,
}: {
  name: string;
  label: string;
  accounts: BankAccountView[];
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-ink-900">{label}</span>
      <select name={name} required className={CONTROL_CLASS}>
        <option value="">Select an account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.entityCode} · {account.name} · {account.accountNumberMasked}
          </option>
        ))}
      </select>
    </label>
  );
}
