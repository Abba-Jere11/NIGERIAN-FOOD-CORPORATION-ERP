'use client';

import { useActionState } from 'react';
import type { AccountView } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { createAccountAction } from '../actions';

export function AccountForm({ entityId, accounts }: { entityId: string; accounts: AccountView[] }) {
  const [state, formAction] = useActionState(createAccountAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="entityId" value={entityId} />
      {state.status === 'error' ? (
        <div className="md:col-span-2">
          <ErrorState message={state.message} />
        </div>
      ) : null}
      <TextField label="Code" name="code" required />
      <TextField label="Name" name="name" required />
      <SelectField
        label="Type"
        name="type"
        required
        options={['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((value) => ({
          value,
          label: value,
        }))}
      />
      <SelectField
        label="Normal balance"
        name="normalBalance"
        required
        options={[
          { value: 'DEBIT', label: 'Debit' },
          { value: 'CREDIT', label: 'Credit' },
        ]}
      />
      <SelectField
        label="Parent"
        name="parentId"
        options={[
          { value: '', label: 'None' },
          ...accounts.map((account) => ({ value: account.id, label: `${account.code} ${account.name}` })),
        ]}
      />
      <TextField label="Consolidation code" name="consolidationCode" />
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" name="intercompany" />
        Intercompany
      </label>
      <div className="md:col-span-2">
        <Button type="submit" variant="primary">
          Add account
        </Button>
      </div>
    </form>
  );
}
