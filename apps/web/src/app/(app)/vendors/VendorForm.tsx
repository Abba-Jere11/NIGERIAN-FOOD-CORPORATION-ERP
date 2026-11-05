'use client';

import { useActionState } from 'react';
import type { VendorCategoryView, VendorView } from '@nfc/shared';
import { IDLE_ACTION_RESULT } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { createVendorAction, updateVendorAction } from './actions';

export function VendorForm({
  categories,
  vendor,
}: {
  categories: VendorCategoryView[];
  vendor?: VendorView;
}) {
  const action = vendor ? updateVendorAction : createVendorAction;
  const [state, formAction] = useActionState(action, IDLE_ACTION_RESULT);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const contact = vendor?.contacts[0];

  return (
    <form action={formAction} className="space-y-3">
      {vendor ? (
        <>
          <input type="hidden" name="id" value={vendor.id} />
          <input type="hidden" name="rowVersion" value={String(vendor.rowVersion)} />
        </>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState title="The vendor was not saved" message={state.message} requestId={state.requestId} />
      ) : null}
      {state.status === 'ok' ? <p className="text-[13px] text-ink-700">{state.message}</p> : null}
      <TextField
        label="Legal name"
        name="legalName"
        required
        defaultValue={vendor?.legalName}
        errors={fieldErrors?.legalName}
      />
      <TextField
        label="CAC registration number"
        name="cacRegistrationNumber"
        required
        defaultValue={vendor?.cacRegistrationNumber}
        errors={fieldErrors?.cacRegistrationNumber}
      />
      <SelectField
        label="Category"
        name="categoryId"
        required
        defaultValue={vendor?.categoryId}
        options={categories.map((row) => ({ value: row.id, label: row.label }))}
        errors={fieldErrors?.categoryId}
      />
      <TextAreaField label="Notes" name="notes" defaultValue={vendor?.notes ?? ''} errors={fieldErrors?.notes} />
      <TextField label="Contact name" name="contactName" defaultValue={contact?.name} />
      <TextField label="Contact phone" name="contactPhone" defaultValue={contact?.phone ?? ''} />
      <TextField label="Contact email" name="contactEmail" defaultValue={contact?.email ?? ''} />
      <TextField label="Contact role" name="contactRole" defaultValue={contact?.role ?? ''} />
      <TextField label="Bank name" name="bankName" defaultValue={vendor?.bank?.bankName} />
      <TextField label="Account name" name="accountName" defaultValue={vendor?.bank?.accountName} />
      <TextField label="Account number" name="accountNumber" defaultValue={vendor?.bank?.accountNumber} />
      <Button type="submit" variant="primary">
        {vendor ? 'Save draft' : 'Create draft'}
      </Button>
    </form>
  );
}
