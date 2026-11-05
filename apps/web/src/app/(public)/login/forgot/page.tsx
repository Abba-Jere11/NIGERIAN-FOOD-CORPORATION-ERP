'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { forgotPasswordAction } from '@/lib/auth-actions';

export default function ForgotPage() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-ink-900">Check your inbox</h1>
        <p className="text-[13px] text-ink-600">
          If that address is registered, a reset link has been queued. In development the URL is also
          written to the API log.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        await forgotPasswordAction(String(data.get('email') ?? ''));
        setSent(true);
      }}
    >
      <h1 className="text-xl font-semibold text-ink-900">Reset password</h1>
      <TextField name="email" type="email" label="Email" required />
      <Button type="submit" variant="primary">
        Send reset link
      </Button>
    </form>
  );
}
