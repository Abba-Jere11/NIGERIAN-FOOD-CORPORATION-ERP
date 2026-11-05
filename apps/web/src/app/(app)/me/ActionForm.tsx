'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import type { ActionResult } from '@/lib/action-result';

export function ActionForm({
  action,
  children,
  submitLabel,
  variant = 'primary',
}: {
  action: (formData: FormData) => Promise<ActionResult | void>;
  children?: ReactNode;
  submitLabel: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const result = await action(new FormData(event.currentTarget));
        setPending(false);
        if (!result) return;
        if (result.status === 'error') {
          setMessage(null);
          setError(result.message);
          return;
        }
        if (result.status === 'ok') setMessage(result.message);
      }}
    >
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px]">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-[13px] text-ink-700">{message}</p> : null}
      {children}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
