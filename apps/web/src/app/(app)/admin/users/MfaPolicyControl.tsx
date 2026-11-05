'use client';

import { useState } from 'react';
import type { UserSummaryView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { setUserMfaPolicyAction } from './actions';

function mfaLabel(user: UserSummaryView): string {
  if (user.mfaEffectiveRequired && user.mfaEnrolled) return 'Enrolled';
  if (user.mfaEffectiveRequired) return 'Required';
  if (user.mfaEnrolled) return 'Enrolled (off)';
  return 'Off';
}

export function MfaPolicyControl({ user }: { user: UserSummaryView }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const adminForced = user.roles.some((role) => role.role === 'administrator');
  const nextRequired = !user.mfaRequired;

  if (adminForced) {
    return (
      <span className="text-[12px] text-ink-600" title="Administrator accounts always require MFA">
        {mfaLabel(user)} (Administrator)
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <span className="text-[12px] text-ink-700">{mfaLabel(user)}</span>
      {!open ? (
        <Button type="button" variant="secondary" className="text-[11px] px-2 py-1" onClick={() => setOpen(true)}>
          {user.mfaRequired ? 'Turn off MFA' : 'Require MFA'}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-1 max-w-xs"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const data = new FormData(event.currentTarget);
            const result = await setUserMfaPolicyAction(
              user.id,
              nextRequired,
              String(data.get('reason') ?? ''),
            );
            if ('error' in result) {
              setError(result.error);
              setPending(false);
              return;
            }
            setOpen(false);
            setPending(false);
          }}
        >
          <TextField name="reason" label="Reason" required minLength={3} />
          {error ? (
            <p role="alert" className="text-[12px] text-danger-800">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Confirm'}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
