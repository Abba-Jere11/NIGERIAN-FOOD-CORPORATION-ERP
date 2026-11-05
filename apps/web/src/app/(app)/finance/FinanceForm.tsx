'use client';

import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { IDLE_ACTION_RESULT, type ActionResult } from '@/lib/action-result';

export function FinanceForm({
  action,
  entityId,
  fields,
  extra,
}: {
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  entityId?: string;
  fields: Array<{
    name: string;
    label: string;
    required?: boolean;
    type?: string;
    defaultValue?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  extra?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, IDLE_ACTION_RESULT);
  return (
    <form action={formAction} className="space-y-3 px-4 py-4">
      {entityId ? <input type="hidden" name="entityId" value={entityId} /> : null}
      {fields.map((field) => (
        <label key={field.name} className="block text-[13px]">
          <span className="font-semibold text-ink-700">{field.label}</span>
          {field.options ? (
            <select
              name={field.name}
              required={field.required}
              defaultValue={field.defaultValue}
              className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5"
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={field.name}
              type={field.type ?? 'text'}
              required={field.required}
              defaultValue={field.defaultValue}
              className="mt-1 block w-full border border-ink-300 bg-surface px-2 py-1.5"
            />
          )}
        </label>
      ))}
      {extra}
      {state.status === 'error' ? <p className="text-[13px] text-danger-700">{state.message}</p> : null}
      <Button type="submit" variant="primary">
        Save
      </Button>
    </form>
  );
}
