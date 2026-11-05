'use client';

import type { EntityView } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/Field';
import { setEntityStatus, updateEntity } from '../actions';

/**
 * Editing and deactivating a subsidiary.
 *
 * `rowVersion` travels with the form. If someone else changed the record first,
 * the API refuses the write and says so, rather than quietly overwriting their
 * work (A7, rule R10).
 */
export function EntityActions({ entity }: { entity: EntityView }) {
  const version = String(entity.rowVersion);
  const isActive = entity.status === 'ACTIVE';

  return (
    <>
      <ActionDialog
        triggerLabel="Edit"
        triggerSize="md"
        title={`Edit ${entity.code}`}
        description="The code cannot be changed: reference numbers already issued depend on it."
        submitLabel="Save changes"
        submitVariant="primary"
        successMessage="Changes saved."
        action={updateEntity}
        hiddenFields={{ id: entity.id, rowVersion: version }}
      >
        {(state) => {
          const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
          return (
            <>
              <TextField
                label="Name"
                name="name"
                required
                defaultValue={entity.name}
                errors={fieldErrors?.name}
              />
              <TextField
                label="Registered name"
                name="legalName"
                required
                defaultValue={entity.legalName}
                errors={fieldErrors?.legalName}
              />
            </>
          );
        }}
      </ActionDialog>

      {entity.type === 'HOLDING' ? null : (
        <ActionDialog
          triggerLabel={isActive ? 'Deactivate' : 'Reactivate'}
          triggerVariant={isActive ? 'danger' : 'secondary'}
          triggerSize="md"
          title={isActive ? `Deactivate ${entity.code}?` : `Reactivate ${entity.code}?`}
          description={
            isActive
              ? 'Nothing is deleted. The subsidiary stops being available for new records, and everything already recorded against it stays exactly as it is.'
              : 'The subsidiary becomes available for new records again.'
          }
          submitLabel={isActive ? 'Deactivate' : 'Reactivate'}
          submitVariant={isActive ? 'danger' : 'primary'}
          successMessage={isActive ? 'Subsidiary deactivated.' : 'Subsidiary reactivated.'}
          action={setEntityStatus}
          hiddenFields={{
            id: entity.id,
            rowVersion: version,
            target: isActive ? 'INACTIVE' : 'ACTIVE',
          }}
          requireReason
          reasonHint="Stored permanently in the audit log and shown to anyone who reviews this change."
        />
      )}
    </>
  );
}
