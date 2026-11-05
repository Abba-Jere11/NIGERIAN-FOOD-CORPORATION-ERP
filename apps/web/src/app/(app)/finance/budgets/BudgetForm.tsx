'use client';

import { useActionState, useState } from 'react';
import type { FiscalYearView } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { createBudgetAction } from '../actions';

export function BudgetForm({ entityId, years }: { entityId: string; years: FiscalYearView[] }) {
  const [state, formAction] = useActionState(createBudgetAction, IDLE_ACTION_RESULT);
  const [rows, setRows] = useState([0]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="entityId" value={entityId} />
      {state.status === 'error' ? <ErrorState message={state.message} /> : null}
      <SelectField
        label="Fiscal year"
        name="fiscalYearId"
        required
        options={years.map((year) => ({ value: year.id, label: String(year.year) }))}
      />
      {rows.map((key) => (
        <div key={key} className="grid gap-2 md:grid-cols-3">
          <TextField label="Code" name="lineCode" required />
          <TextField label="Name" name="lineName" required />
          <TextField label="Approved (₦)" name="lineAmount" required />
        </div>
      ))}
      <Button type="button" variant="subtle" onClick={() => setRows((current) => [...current, current.length])}>
        Add line
      </Button>
      <div>
        <Button type="submit" variant="primary">
          Save draft version
        </Button>
      </div>
    </form>
  );
}
