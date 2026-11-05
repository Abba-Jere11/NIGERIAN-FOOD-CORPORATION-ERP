import { cx } from '@/lib/cx';

/**
 * Sober status badges (A8): a border, a label and nothing else. The tone
 * carries meaning, so the same status always reads the same way across modules.
 */
export type BadgeTone = 'neutral' | 'active' | 'pending' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  active: 'bg-accent-50 text-accent-800 border-accent-100',
  pending: 'bg-surface-muted text-ink-700 border-ink-300',
  warning: 'bg-warning-100 text-warning-700 border-warning-100',
  danger: 'bg-danger-100 text-danger-700 border-danger-100',
  info: 'bg-info-100 text-info-700 border-info-100',
};

/**
 * Status vocabulary to tone. Procurement statuses from A7 are mapped now so
 * that M6 to M9 do not each invent their own colours.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: 'active',
  COMPLETED: 'active',
  INACTIVE: 'neutral',
  ARCHIVED: 'neutral',
  DISCARDED: 'neutral',
  DRAFT: 'pending',
  NEED_APPROVED: 'active',
  RETURNED: 'warning',
  PENDING_REVIEW: 'pending',
  PENDING_REVERIFICATION: 'warning',
  AWAITING_NEED_APPROVAL: 'pending',
  AWAITING_PREPARATION: 'pending',
  AWAITING_OPERATIONS: 'pending',
  AWAITING_MD: 'pending',
  AWAITING_ED_FINANCE: 'pending',
  FUNDING_PENDING: 'pending',
  AWAITING_PAYMENT: 'pending',
  PAYMENT_PROCESSING: 'info',
  AWAITING_DELIVERY: 'info',
  PARTIALLY_RECEIVED: 'warning',
  REJECTED: 'danger',
  SUSPENDED: 'warning',
  BLACKLISTED: 'danger',
  PENDING_APPROVAL: 'pending',
  POSTED: 'active',
  REVERSED: 'warning',
  OPEN: 'active',
  IN_PROGRESS: 'pending',
  CLOSED: 'neutral',
  LOCKED: 'danger',
  APPROVED: 'active',
  MATCHED: 'active',
  UNPAID: 'warning',
  PART_PAID: 'warning',
  PAID: 'active',
  OVERDUE: 'danger',
  OK: 'active',
  FAIL: 'danger',
  INFO: 'info',
  UNAVAILABLE: 'neutral',
  SUBMITTED: 'pending',
  UNDER_REVIEW: 'info',
  ISSUED: 'info',
  ACKNOWLEDGED: 'pending',
  RESPONSE_SUBMITTED: 'warning',
  FURTHER_ACTION_REQUIRED: 'warning',
  REOPENED: 'warning',
  ACCEPTED: 'active',
};

export function statusLabel(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export function StatusBadge({
  status,
  tone,
  className,
}: {
  status: string;
  tone?: BadgeTone;
  className?: string;
}) {
  const resolved = tone ?? STATUS_TONES[status] ?? 'neutral';
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-sm border px-1.5 py-0.5',
        'text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap',
        TONES[resolved],
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
