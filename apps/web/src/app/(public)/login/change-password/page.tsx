'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { changePasswordAction } from '@/lib/auth-actions';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const data = new FormData(event.currentTarget);
        const result = await changePasswordAction(
          String(data.get('currentPassword') ?? ''),
          String(data.get('password') ?? ''),
        );
        if ('error' in result) {
          setError(result.error);
          setPending(false);
          return;
        }
        if (result.mfaEnrolRequired) {
          router.push('/login/mfa-enrol');
        } else {
          router.push('/home');
        }
        router.refresh();
      }}
    >
      <h1 className="text-xl font-semibold text-ink-900">Change your password</h1>
      <p className="text-[13px] text-ink-600">You must set a new password before using the system.</p>
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px]">
          {error}
        </p>
      ) : null}
      <TextField
        name="currentPassword"
        type="password"
        label="Current password"
        autoComplete="current-password"
        required
      />
      <TextField
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        hint="At least 12 characters, mixed classes."
        required
      />
      <Button type="submit" variant="primary" disabled={pending}>
        Save password
      </Button>
    </form>
  );
}
