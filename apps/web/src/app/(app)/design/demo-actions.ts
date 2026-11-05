'use server';

import type { ActionResult } from '@/lib/action-result';

/**
 * Stand-in server actions for the design reference. They take and return exactly
 * what real actions do, so the exhibits show genuine pending states and genuine
 * server-side field errors rather than a mock.
 */
export async function demoConfirm(): Promise<ActionResult> {
  return { status: 'ok', message: 'Confirmed.' };
}

export async function demoWithReason(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get('reason') ?? '').trim();

  if (reason.length < 5) {
    return {
      status: 'error',
      message: 'A reason is required.',
      fieldErrors: {
        reason: ['Give a reason of at least five characters. It is stored permanently.'],
      },
    };
  }

  return { status: 'ok', message: 'Recorded with your reason.' };
}

export async function demoFails(): Promise<ActionResult> {
  return {
    status: 'error',
    message:
      'This subsidiary was changed by someone else while you were editing it. Reload and try again.',
    requestId: '01J8Z9K3QX4M7VH2',
  };
}
