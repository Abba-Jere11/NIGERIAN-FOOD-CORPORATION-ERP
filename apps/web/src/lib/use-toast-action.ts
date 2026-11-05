'use client';

import { useActionState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { IDLE_ACTION_RESULT, type ActionResult } from './action-result';

type ServerAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

interface ToastActionOptions {
  /** Overrides the server's success message. */
  successMessage?: string;
  /** Prefixes the server's error message, e.g. "Invoice was not attached". */
  errorTitle?: string;
  onSuccess?: (result: Extract<ActionResult, { status: 'ok' }>) => void;
}

export function toastMessageFor(result: ActionResult, options: ToastActionOptions = {}): string | null {
  if (result.status === 'ok') return options.successMessage ?? result.message;
  if (result.status === 'error') return options.errorTitle ? `${options.errorTitle}: ${result.message}` : result.message;
  return null;
}

/**
 * `useActionState` that also reports the outcome as a toast, so every action
 * gives the same success or failure feedback. Inline errors still render from
 * the returned state for anything the user needs to re-read.
 */
export function useToastAction(action: ServerAction, options: ToastActionOptions = {}) {
  const { toast } = useToast();
  return useActionState(async (previous: ActionResult, formData: FormData): Promise<ActionResult> => {
    const result = await action(previous, formData);
    // A redirecting action resolves without a result; its notice toasts on the next page.
    if (!result) return previous;
    const message = toastMessageFor(result, options);
    if (message) toast(message, result.status === 'ok' ? 'success' : 'error');
    if (result.status === 'ok') options.onSuccess?.(result);
    return result;
  }, IDLE_ACTION_RESULT);
}
