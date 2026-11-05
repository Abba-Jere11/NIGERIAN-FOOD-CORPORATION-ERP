'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import type { StaffInvitePreview } from '@nfc/shared';
import { registerWithInvite } from '../../actions';

export function RegisterForm({ token, preview }: { token: string; preview: StaffInvitePreview }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const done = message !== null;

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const result = await registerWithInvite(token, new FormData(event.currentTarget));
        setPending(false);
        if (result.status === 'error') setError(result.message);
        if (result.status === 'ok') setMessage(result.message);
      }}
    >
      <p className="text-[13px]">
        {preview.firstName} {preview.lastName} · {preview.email}
      </p>
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px]">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-[13px]">{message}</p> : null}
      {done ? null : (
        <>
          <TextField name="password" type="password" label="Password" autoComplete="new-password" required />
          <TextField name="otherNames" label="Other names" />
          <TextField name="gender" label="Gender" />
          <TextField name="personalPhone" label="Personal phone" />
          <TextField name="emergencyName" label="Emergency contact" />
          <TextField name="emergencyPhone" label="Emergency phone" />
          <TextField name="bankName" label="Bank" />
          <TextField name="bankAccountName" label="Account name" />
          <TextField name="bankAccountNumber" label="Account number" />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </>
      )}
    </form>
  );
}
