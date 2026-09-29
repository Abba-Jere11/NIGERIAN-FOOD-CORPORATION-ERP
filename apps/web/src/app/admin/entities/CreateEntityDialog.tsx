'use client';

import { ActionDialog } from '@/components/ui/Dialog';
import { CONTROL_CLASS, TextField } from '@/components/ui/Field';
import { cx } from '@/lib/cx';
import { createEntity } from './actions';

/**
 * Creating a subsidiary. The parent is not asked for: every subsidiary is a
 * direct child of the holding company (A4), so offering the choice would only
 * invite a structure the database refuses anyway.
 */
export function CreateEntityDialog() {
  return (
    <ActionDialog
      triggerLabel="New subsidiary"
      triggerVariant="primary"
      triggerSize="md"
      title="New subsidiary"
      description="It will be created as a direct child of Nigeria Food Corporation, with no departments yet."
      submitLabel="Create subsidiary"
      submitVariant="primary"
      successMessage="Subsidiary created."
      action={createEntity}
    >
      {(state) => {
        const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
        return (
          <>
            <TextField
              label="Code"
              name="code"
              required
              maxLength={10}
              placeholder="YFZ"
              hint="Two to ten capital letters or digits. Used in reference numbers."
              className={cx(CONTROL_CLASS, 'font-mono uppercase')}
              errors={fieldErrors?.code}
            />
            <TextField
              label="Name"
              name="name"
              required
              placeholder="Yuci Flour Zaria"
              hint="The short name used throughout the system."
              errors={fieldErrors?.name}
            />
            <TextField
              label="Registered name"
              name="legalName"
              placeholder="Yuci Flour Mills Zaria Limited"
              hint="As registered. Leave blank to reuse the name above."
              errors={fieldErrors?.legalName}
            />
          </>
        );
      }}
    </ActionDialog>
  );
}
