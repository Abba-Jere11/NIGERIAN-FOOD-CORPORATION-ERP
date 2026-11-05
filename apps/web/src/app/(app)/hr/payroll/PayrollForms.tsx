'use client';

import { useActionState } from 'react';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import {
  adjustRunAction,
  calculateRunAction,
  confirmStructureAction,
  createRunAction,
  createStructureAction,
  payRunAction,
  remitRunAction,
  submitRunAction,
  updateSettingsAction,
} from './actions';

type Option = { value: string; label: string };

function IdempotencyField() {
  return (
    <input
      type="hidden"
      name="idempotencyKey"
      defaultValue={`prl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}
    />
  );
}

export function StructureForm({
  entities,
  employees,
}: {
  entities: Option[];
  employees: Option[];
}) {
  const [state, formAction] = useActionState(createStructureAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      {state.status === 'error' ? (
        <div className="sm:col-span-2">
          <ErrorState title="Structure not saved" message={state.message} requestId={state.requestId} />
        </div>
      ) : null}
      <SelectField label="Subsidiary" name="entityId" required options={entities} />
      <SelectField label="Employee" name="employeeId" required options={employees} />
      <TextField label="Basic (kobo)" name="basicKobo" required />
      <TextField label="Effective on" name="effectiveOn" type="date" required />
      <div className="sm:col-span-2">
        <Button type="submit">Save draft structure</Button>
      </div>
    </form>
  );
}

export function ConfirmStructureForm({ id, rowVersion }: { id: string; rowVersion: number }) {
  const [state, formAction] = useActionState(confirmStructureAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? <span className="mr-2 text-[12px] text-danger-700">{state.message}</span> : null}
      <Button type="submit" variant="secondary">
        Confirm
      </Button>
    </form>
  );
}

export function CreateRunForm({ entities, periods }: { entities: Option[]; periods: Option[] }) {
  const [state, formAction] = useActionState(createRunAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <IdempotencyField />
      {state.status === 'error' ? (
        <div className="sm:col-span-2">
          <ErrorState title="Run not created" message={state.message} requestId={state.requestId} />
        </div>
      ) : null}
      <SelectField label="Subsidiary" name="entityId" required options={entities} />
      <SelectField label="Fiscal period" name="fiscalPeriodId" required options={periods} />
      <div className="sm:col-span-2">
        <Button type="submit">Create payroll run</Button>
      </div>
    </form>
  );
}

export function RunActionForm({
  id,
  rowVersion,
  action,
  label,
}: {
  id: string;
  rowVersion: number;
  action: 'calculate' | 'submit';
  label: string;
}) {
  const [state, formAction] = useActionState(
    action === 'calculate' ? calculateRunAction : submitRunAction,
    IDLE_ACTION_RESULT,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? <p className="mb-2 text-[13px] text-danger-700">{state.message}</p> : null}
      <Button type="submit">{label}</Button>
    </form>
  );
}

export function PayRunForm({ id, rowVersion }: { id: string; rowVersion: number }) {
  const [state, formAction] = useActionState(payRunAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <IdempotencyField />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? (
        <div className="sm:col-span-2">
          <ErrorState title="Payment failed" message={state.message} requestId={state.requestId} />
        </div>
      ) : null}
      <TextField label="Evidence document id" name="evidenceDocumentId" required />
      <div className="sm:col-span-2">
        <Button type="submit">Pay locked run</Button>
      </div>
    </form>
  );
}

export function RemitForm({ id, rowVersion }: { id: string; rowVersion: number }) {
  const [state, formAction] = useActionState(remitRunAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? (
        <div className="sm:col-span-2">
          <ErrorState title="Remittance failed" message={state.message} requestId={state.requestId} />
        </div>
      ) : null}
      <SelectField
        label="Kind"
        name="kind"
        required
        options={[
          { value: 'PAYE', label: 'PAYE' },
          { value: 'PENSION', label: 'Pension' },
        ]}
      />
      <TextField label="Evidence document id" name="evidenceDocumentId" required />
      <div className="sm:col-span-2">
        <Button type="submit">Mark remitted</Button>
      </div>
    </form>
  );
}

export function AdjustRunForm({ id, rowVersion }: { id: string; rowVersion: number }) {
  const [state, formAction] = useActionState(adjustRunAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3">
      <IdempotencyField />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? (
        <ErrorState title="Adjustment failed" message={state.message} requestId={state.requestId} />
      ) : null}
      <TextField label="Reason" name="reason" required />
      <div>
        <Button type="submit" variant="secondary">
          Reverse and open a new run
        </Button>
      </div>
    </form>
  );
}

export function SettingsForm({
  threshold,
  overtime,
  includeSuspended,
  divisor,
  rowVersion,
}: {
  threshold: number;
  overtime: number;
  includeSuspended: boolean;
  divisor: number;
  rowVersion: number;
}) {
  const [state, formAction] = useActionState(updateSettingsAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="rowVersion" value={rowVersion} />
      {state.status === 'error' ? (
        <div className="sm:col-span-2">
          <ErrorState title="Settings not saved" message={state.message} requestId={state.requestId} />
        </div>
      ) : null}
      <TextField label="ED Finance threshold (kobo)" name="edFinanceThresholdKobo" defaultValue={String(threshold)} required />
      <TextField label="Overtime multiplier (bps)" name="overtimeMultiplierBps" defaultValue={String(overtime)} required />
      <TextField label="Working days divisor" name="unpaidLeaveDailyDivisor" defaultValue={String(divisor)} required />
      <SelectField
        label="Include suspended staff"
        name="includeSuspended"
        defaultValue={includeSuspended ? 'true' : 'false'}
        options={[
          { value: 'false', label: 'No' },
          { value: 'true', label: 'Yes' },
        ]}
      />
      <div className="sm:col-span-2">
        <Button type="submit">Save settings</Button>
      </div>
    </form>
  );
}
