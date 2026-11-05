'use client';

import { useActionState } from 'react';
import type { CasePersonView, CaseStatus } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import {
  addCaseAccessAction,
  addCaseCommentAction,
  createCaseAction,
  setCaseStatusAction,
} from './actions';

export function CaseCreateForm({
  entities,
}: {
  entities: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction] = useActionState(createCaseAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="The case was not opened" message={state.message} requestId={state.requestId} />
      ) : null}
      <SelectField
        label="Subsidiary"
        name="entityId"
        required
        placeholder="Choose a subsidiary"
        options={entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
      />
      <TextField label="Title" name="title" required maxLength={200} />
      <TextAreaField label="Details" name="body" required rows={8} maxLength={8000} />
      <Button type="submit" variant="primary">
        Open case
      </Button>
    </form>
  );
}

export function CaseCommentForm({ caseId }: { caseId: string }) {
  const [state, formAction] = useActionState(addCaseCommentAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={caseId} />
      {state.status === 'error' ? (
        <ErrorState title="Comment was not saved" message={state.message} requestId={state.requestId} />
      ) : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <TextAreaField label="Comment" name="body" required rows={3} maxLength={4000} />
      <Button type="submit" variant="secondary" size="sm">
        Add comment
      </Button>
    </form>
  );
}

export function CaseAccessForm({
  caseId,
  kind,
  label,
  people,
}: {
  caseId: string;
  kind: 'ASSIGNEE' | 'GRANT' | 'CC';
  label: string;
  people: CasePersonView[];
}) {
  const [state, formAction] = useActionState(addCaseAccessAction, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={caseId} />
      <input type="hidden" name="kind" value={kind} />
      {state.status === 'error' ? (
        <ErrorState title={`${label} failed`} message={state.message} requestId={state.requestId} />
      ) : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <SelectField
        label={label}
        name="userId"
        required
        placeholder="Choose a person"
        options={people.map((row) => ({ value: row.id, label: row.name }))}
      />
      <Button type="submit" variant="secondary" size="sm">
        {label}
      </Button>
    </form>
  );
}

export function CaseStatusForm({
  caseId,
  status,
  canClose,
}: {
  caseId: string;
  status: CaseStatus;
  canClose: boolean;
}) {
  const [state, formAction] = useActionState(setCaseStatusAction, IDLE_ACTION_RESULT);
  const options: Array<{ value: CaseStatus; label: string }> = [
    { value: 'OPEN', label: 'Open' },
    { value: 'IN_PROGRESS', label: 'In progress' },
  ];
  if (canClose || status === 'CLOSED') options.push({ value: 'CLOSED', label: 'Closed' });
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={caseId} />
      {state.status === 'error' ? (
        <ErrorState title="Status was not updated" message={state.message} requestId={state.requestId} />
      ) : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <SelectField label="Status" name="status" required defaultValue={status} options={options} />
      <Button type="submit" variant="secondary" size="sm">
        Update status
      </Button>
    </form>
  );
}
