'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { resetPasswordAction } from '@/lib/auth-actions';

export default function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const result = await resetPasswordAction(token, String(data.get('password') ?? ''));
        if ('error' in result) {
          setError(result.error);
          return;
        }
        router.push('/login');
      }}
    >
      <h1 className="text-xl font-semibold text-ink-900">Choose a new password</h1>
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px]">
          {error}
        </p>
      ) : null}
      <TextField name="password" type="password" label="New password" autoComplete="new-password" required />
      <Button type="submit" variant="primary">
        Save
      </Button>
    </form>
  );
}
