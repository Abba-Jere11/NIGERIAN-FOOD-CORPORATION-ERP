'use client';

import { formatLagosDateTime } from '@nfc/shared';
import type { AutosaveState } from '@/lib/use-draft-autosave';
import { cx } from '@/lib/cx';

export function AutosaveStatus({ status }: { status: AutosaveState }) {
  const text =
    status.state === 'saving'
      ? 'Saving…'
      : status.state === 'saved'
        ? `Saved ${formatLagosDateTime(status.savedAt.toISOString())}`
        : status.state === 'error'
          ? `Not saved: ${status.message}`
          : 'Changes save automatically.';
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="autosave-status"
      className={cx('text-[12px]', status.state === 'error' ? 'text-danger-700' : 'text-ink-500')}
    >
      {text}
    </p>
  );
}
