'use client';

import { useActionState } from 'react';
import type { EntityView } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ErrorState } from '@/components/ui/States';
import { createBudgetLineAction, createProjectAction } from './actions';

export function BudgetLineForm({ entities }: { entities: EntityView[] }) {
  const [state, formAction] = useActionState(createBudgetLineAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="Budget line was not created" message={state.message} requestId={state.requestId} />
      ) : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <SelectField
        label="Entity"
        name="entityId"
        required
        options={entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
      />
      <TextField label="Fiscal year" name="fiscalYear" type="number" required defaultValue="2026" />
      <TextField label="Code" name="code" required />
      <TextField label="Name" name="name" required />
      <MoneyInput label="Approved amount" name="approvedAmountKobo" required />
      <Button type="submit" variant="primary">
        Add budget line
      </Button>
    </form>
  );
}

export function ProjectForm({ entities }: { entities: EntityView[] }) {
  const [state, formAction] = useActionState(createProjectAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="Project was not created" message={state.message} requestId={state.requestId} />
      ) : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <SelectField
        label="Entity"
        name="entityId"
        required
        options={entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
      />
      <TextField label="Code" name="code" required />
      <TextField label="Name" name="name" required />
      <Button type="submit" variant="primary">
        Add project
      </Button>
    </form>
  );
}
