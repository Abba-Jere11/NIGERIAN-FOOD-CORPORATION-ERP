import Link from 'next/link';
import type { BudgetLineBalanceView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { withScope } from '../scope';

function sum(lines: BudgetLineBalanceView[], key: keyof BudgetLineBalanceView): number {
  return lines.reduce((total, line) => total + Number(line[key] ?? 0), 0);
}

function utilizationTone(pct: number): { label: string; className: string } {
  if (pct >= 100) return { label: 'Over', className: 'text-danger-700' };
  if (pct >= 90) return { label: 'Near', className: 'text-warning-700' };
  return { label: 'Healthy', className: 'text-ink-600' };
}

export function BudgetProgressStrip({
  lines,
  compact,
  scope,
  budgetId,
}: {
  lines: BudgetLineBalanceView[];
  compact?: boolean;
  scope?: string;
  budgetId?: string;
}) {
  const approved = sum(lines, 'approvedKobo');
  const committed = sum(lines, 'committedKobo');
  const paid = sum(lines, 'paidKobo');
  const available = sum(lines, 'availableKobo');
  const denom = approved > 0 ? approved : 1;
  const committedPct = Math.min(100, Math.round((committed / denom) * 100));
  const paidPct = Math.min(100, Math.round((paid / denom) * 100));
  const usedPct = Math.min(100, Math.round((paid / denom) * 100));
  const tone = utilizationTone(usedPct);
  const budgetQuery = budgetId ? `&budgetId=${budgetId}` : '';

  const metrics = [
    { label: 'Approved', value: approved, metric: 'approved' as const },
    { label: 'Committed', value: committed, metric: 'committed' as const },
    { label: 'Paid', value: paid, metric: 'paid' as const },
    { label: 'Available', value: available, metric: 'available' as const },
  ];

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2 px-4 py-3'}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-ink-600">
        {metrics.map((item) => {
          const href = withScope(`/finance/budgets/activity?metric=${item.metric}${budgetQuery}`, scope);
          return (
            <Link key={item.metric} href={href} className="hover:underline">
              {item.label}{' '}
              <span className="tabular font-medium text-ink-900">{formatKobo(BigInt(item.value))}</span>
            </Link>
          );
        })}
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${tone.className}`}>
          {tone.label} · {usedPct}% used
        </span>
      </div>
      <div className="relative h-2 overflow-hidden bg-ink-100" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-ink-300" style={{ width: `${committedPct}%` }} />
        <div className="absolute inset-y-0 left-0 bg-accent-600/70" style={{ width: `${paidPct}%` }} />
      </div>
    </div>
  );
}
