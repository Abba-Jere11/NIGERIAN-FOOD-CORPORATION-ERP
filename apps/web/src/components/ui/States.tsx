import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

/**
 * Empty, loading and error states.
 *
 * A8 requires that no panel is rendered with nothing in it. These give a panel
 * something honest to say instead of an empty rectangle.
 */

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('px-4 py-10 text-center', className)}>
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading', rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div className="px-4 py-4" aria-busy="true" aria-live="polite">
      <p className="sr-only">{label}</p>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="h-8 animate-pulse bg-ink-100"
            style={{ animationDelay: `${index * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  title = 'This could not be loaded',
  message,
  requestId,
  action,
}: {
  title?: string;
  message: string;
  requestId?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="border-l-2 border-danger-600 bg-danger-100 px-4 py-3" role="alert">
      <p className="text-sm font-semibold text-danger-700">{title}</p>
      <p className="mt-1 text-[13px] text-ink-700">{message}</p>
      {requestId ? (
        <p className="mt-1 font-mono text-[11px] text-ink-500">Request id: {requestId}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** A short inline notice. Used for scope explanations and warnings. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-info-700 bg-info-100 text-ink-900',
    warning: 'border-warning-600 bg-warning-100 text-ink-900',
    danger: 'border-danger-600 bg-danger-100 text-ink-900',
  } as const;

  return (
    <div className={cx('border-l-2 px-3 py-2 text-[13px]', tones[tone])} role="note">
      {children}
    </div>
  );
}
