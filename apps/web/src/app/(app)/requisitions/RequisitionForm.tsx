'use client';

import { useRef, useState, type FormEvent } from 'react';
import type {
  DepartmentView,
  ProcurementCategoryView,
  RequisitionView,
  UnitOfMeasureView,
} from '@nfc/shared';
import { PROCUREMENT_URGENCIES, PROCUREMENT_URGENCY_LABELS } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { useDraftAutosave } from '@/lib/use-draft-autosave';
import { toastMessageFor, useToastAction } from '@/lib/use-toast-action';
import { AutosaveStatus } from '@/components/forms/AutosaveStatus';
import { DraftVersionInput, useDraftVersion } from '@/components/forms/DraftVersion';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { createRequisitionAction, updateRequisitionAction } from './actions';

export function RequisitionForm({
  requisition,
  departments,
  categories,
  units,
}: {
  requisition?: RequisitionView;
  departments: DepartmentView[];
  categories: ProcurementCategoryView[];
  units: UnitOfMeasureView[];
}) {
  if (!requisition) return <CreateRequisitionForm departments={departments} />;
  return (
    <EditRequisitionForm requisition={requisition} departments={departments} categories={categories} units={units} />
  );
}

function CreateRequisitionForm({ departments }: { departments: DepartmentView[] }) {
  const [state, formAction] = useToastAction(createRequisitionAction, {
    errorTitle: 'The requisition was not created',
  });
  return (
    <form action={formAction} className="space-y-3">
      {state.status === 'error' ? (
        <ErrorState title="The requisition was not created" message={state.message} requestId={state.requestId} />
      ) : null}
      <TextField label="Title" name="title" required />
      <SelectField
        label="Department"
        name="departmentId"
        options={departments.map((row) => ({ value: row.id, label: row.name }))}
      />
      <Button type="submit" variant="primary">
        Create draft
      </Button>
    </form>
  );
}

function EditRequisitionForm({
  requisition,
  departments,
  categories,
  units,
}: {
  requisition: RequisitionView;
  departments: DepartmentView[];
  categories: ProcurementCategoryView[];
  units: UnitOfMeasureView[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useDraftVersion();
  const { toast } = useToast();
  const [lastError, setLastError] = useState<{ message: string; requestId?: string | null } | null>(null);
  const [lineKeys, setLineKeys] = useState(() => {
    if (requisition.lines && requisition.lines.length > 0) return requisition.lines.map((line) => line.id);
    return ['line-0'];
  });

  const autosave = useDraftAutosave({
    formRef,
    enabled: true,
    save: (formData) => updateRequisitionAction(IDLE_ACTION_RESULT, formData),
    prepare: (formData) => {
      if (draft) formData.set('rowVersion', String(draft.current()));
    },
    onResult: (result) => {
      if (result.status === 'ok') {
        draft?.advance(result.rowVersion);
        setLastError(null);
      }
    },
  });

  async function onManualSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const result = await autosave.saveNow();
    if (!result) return;
    if (result.status === 'error') setLastError({ message: result.message, requestId: result.requestId });
    const message = toastMessageFor(result, { errorTitle: 'The requisition was not saved' });
    if (message) toast(message, result.status === 'ok' ? 'success' : 'error');
  }

  return (
    <form
      ref={formRef}
      className="space-y-3"
      onSubmit={(event) => void onManualSave(event)}
      onChange={() => autosave.schedule()}
    >
      <input type="hidden" name="id" value={requisition.id} />
      <DraftVersionInput fallback={requisition.rowVersion} />
      {lastError ? (
        <ErrorState
          title="The requisition was not saved"
          message={lastError.message}
          requestId={lastError.requestId ?? null}
        />
      ) : null}
      <TextField label="Title" name="title" required defaultValue={requisition.title} />
      <SelectField
        label="Department"
        name="departmentId"
        required
        defaultValue={requisition.departmentId ?? ''}
        options={departments.map((row) => ({ value: row.id, label: row.name }))}
      />
      <SelectField
        label="Category"
        name="categoryId"
        required
        defaultValue={requisition.categoryId ?? ''}
        options={categories.map((row) => ({ value: row.id, label: row.name }))}
      />
      <TextAreaField label="Background" name="background" required defaultValue={requisition.background ?? ''} />
      <TextAreaField
        label="Justification"
        name="justification"
        required
        defaultValue={requisition.justification ?? ''}
      />
      <TextAreaField label="Prayer" name="prayer" required defaultValue={requisition.prayer ?? ''} />
      <div className="space-y-3">
        {lineKeys.map((key, index) => {
          const existing = (requisition.lines ?? []).find((line) => line.id === key) ?? requisition.lines?.[index];
          return (
            <fieldset key={key} className="space-y-2 rounded border border-ink-200 p-3">
              <legend className="text-[12px] font-semibold text-ink-800">Item {index + 1}</legend>
              <TextField
                label="Description"
                name={`lines[${index}].description`}
                required
                defaultValue={existing?.description ?? ''}
              />
              <TextField
                label="Quantity"
                name={`lines[${index}].quantity`}
                type="number"
                required
                defaultValue={existing ? String(existing.quantity) : ''}
              />
              <SelectField
                label="Unit"
                name={`lines[${index}].unitId`}
                required
                defaultValue={existing?.unitId ?? ''}
                options={units.map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
              />
              {lineKeys.length > 1 ? (
                <Button
                  type="button"
                  onClick={() => {
                    setLineKeys((current) => current.filter((item) => item !== key));
                    autosave.schedule();
                  }}
                >
                  Remove item
                </Button>
              ) : null}
            </fieldset>
          );
        })}
        <Button type="button" onClick={() => setLineKeys((current) => [...current, `line-${Date.now()}`])}>
          Add item
        </Button>
      </div>
      <TextField label="Required date" name="requiredDate" type="date" required defaultValue={requisition.requiredDate ?? ''} />
      <TextField
        label="Delivery location"
        name="deliveryLocation"
        required
        defaultValue={requisition.deliveryLocation ?? ''}
      />
      <SelectField
        label="Urgency"
        name="urgency"
        defaultValue={requisition.urgency}
        options={PROCUREMENT_URGENCIES.map((row) => ({ value: row, label: PROCUREMENT_URGENCY_LABELS[row] }))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={autosave.status.state === 'saving'}>
          Save draft
        </Button>
        <AutosaveStatus status={autosave.status} />
      </div>
    </form>
  );
}
