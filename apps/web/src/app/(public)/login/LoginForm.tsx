'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { continueAfterAuth, loginWithPassword } from '@/lib/auth-actions';

export function LoginForm() {
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
        const result = await loginWithPassword(
          String(data.get('email') ?? ''),
          String(data.get('password') ?? ''),
        );
        if ('error' in result) {
          setError(result.error);
          setPending(false);
          return;
        }
        await continueAfterAuth(result);
        router.refresh();
      }}
    >
      <h1 className="text-xl font-semibold text-ink-900">Sign in</h1>
      <p className="text-[13px] text-ink-600">One sign-in for every role.</p>
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px] text-danger-800">
          {error}
        </p>
      ) : null}
      <TextField name="email" type="email" label="Email" autoComplete="username" required />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-[12px] text-ink-500">
        <a href="/login/forgot" className="underline">
          Forgot password
        </a>
      </p>
    </form>
  );
}
