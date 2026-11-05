'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { continueAfterAuth, verifyMfaCode } from '@/lib/auth-actions';

export default function MfaPage() {
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
        const result = await verifyMfaCode(String(data.get('code') ?? ''));
        if ('error' in result) {
          setError(result.error);
          setPending(false);
          return;
        }
        await continueAfterAuth(result);
        router.refresh();
      }}
    >
      <h1 className="text-xl font-semibold text-ink-900">Authenticator code</h1>
      <p className="text-[13px] text-ink-600">Enter the 6-digit code from your authenticator app, or a backup code.</p>
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px]">
          {error}
        </p>
      ) : null}
      <TextField name="code" label="Code" autoComplete="one-time-code" required />
      <Button type="submit" variant="primary" disabled={pending}>
        Continue
      </Button>
    </form>
  );
}
