'use client';

import { useActionState, useState } from 'react';
import type { AccountView, FiscalPeriodView } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { createJournalAction } from '../actions';

export function JournalForm({
  entityId,
  periods,
  accounts,
}: {
  entityId: string;
  periods: FiscalPeriodView[];
  accounts: AccountView[];
}) {
  const [state, formAction] = useActionState(createJournalAction, IDLE_ACTION_RESULT);
  const [rows, setRows] = useState([0, 1]);
  const options = accounts
    .filter((account) => account.active)
    .map((account) => ({ value: account.id, label: `${account.code} ${account.name}` }));

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="entityId" value={entityId} />
      {state.status === 'error' ? <ErrorState message={state.message} requestId={state.requestId} /> : null}
      <TextField label="Narration" name="narration" required />
      <SelectField
        label="Period"
        name="fiscalPeriodId"
        required
        options={periods.map((period) => ({
          value: period.id,
          label: `${period.name} (${period.status})`,
        }))}
      />
      <div className="space-y-2">
        {rows.map((key) => (
          <div key={key} className="grid gap-2 md:grid-cols-3">
            <SelectField label="Account" name="accountId" required options={options} />
            <SelectField
              label="Side"
              name="side"
              required
              options={[
                { value: 'DEBIT', label: 'Debit' },
                { value: 'CREDIT', label: 'Credit' },
              ]}
            />
            <TextField label="Amount (₦)" name="amount" required />
          </div>
        ))}
      </div>
      <Button type="button" variant="subtle" onClick={() => setRows((current) => [...current, current.length])}>
        Add line
      </Button>
      <div>
        <Button type="submit" variant="primary">
          Save draft
        </Button>
      </div>
    </form>
  );
}
