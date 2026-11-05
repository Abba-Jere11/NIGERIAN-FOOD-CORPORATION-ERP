import type { ProcurementNextAction, ProcurementProgressStep } from '@nfc/shared';
import { formatLagosDateTime } from '@nfc/shared';
import { cx } from '@/lib/cx';

const MARKS: Record<ProcurementProgressStep['state'], { glyph: string; className: string; srLabel: string }> = {
  done: { glyph: '\u2713', className: 'text-accent-700 border-accent-700', srLabel: 'completed' },
  current: { glyph: '\u25CF', className: 'text-ink-900 border-ink-900 bg-ink-100', srLabel: 'current step' },
  pending: { glyph: '\u25CB', className: 'text-ink-400 border-ink-300', srLabel: 'not started' },
  returned: { glyph: '\u21A9', className: 'text-warning-700 border-warning-600', srLabel: 'returned for correction' },
  rejected: { glyph: '\u00D7', className: 'text-danger-700 border-danger-600', srLabel: 'rejected' },
};

/** The procurement tracker: every step in payment-arrangement order, with who is responsible. */
export function ProcurementTracker({ steps }: { steps: ProcurementProgressStep[] }) {
  return (
    <ol className="space-y-0" data-testid="procurement-tracker">
      {steps.map((step, index) => {
        const mark = MARKS[step.state];
        const isLast = index === steps.length - 1;
        return (
          <li key={step.key} className="flex gap-3" data-step={step.key} data-state={step.state}>
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] leading-none',
                  mark.className,
                )}
              >
                {mark.glyph}
              </span>
              {!isLast ? <span aria-hidden="true" className="w-px flex-1 bg-ink-200" /> : null}
            </div>
            <div className="pb-3">
              <p
                className={cx(
                  'text-[13px] leading-tight',
                  step.state === 'current' ? 'font-semibold text-ink-900' : 'text-ink-700',
                )}
              >
                {step.label}
                <span className="sr-only"> — {mark.srLabel}</span>
              </p>
              <p className="text-[11px] text-ink-500">
                {step.state === 'done' && step.actor ? step.actor : step.responsible}
                {step.state === 'done' && step.at ? ` · ${formatLagosDateTime(step.at)}` : ''}
              </p>
              {step.state === 'current' && step.action ? (
                <p className="text-[12px] text-ink-800">Waiting for: {step.action}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Banner at the top of the record naming the next action and who must take it. */
export function NextActionBanner({ action, canAct }: { action: ProcurementNextAction; canAct: boolean }) {
  return (
    <div
      role="status"
      data-testid="next-action"
      className={cx(
        'mb-4 flex flex-wrap items-center justify-between gap-2 border-l-2 px-3 py-2 text-[13px]',
        canAct ? 'border-accent-700 bg-accent-50' : 'border-ink-300 bg-ink-50',
      )}
    >
      <p>
        <span className="font-semibold text-ink-900">Next action: {action.label}</span>
        <span className="text-ink-700"> · Responsible: {canAct ? `you (${action.responsible})` : action.responsible}</span>
      </p>
      {canAct ? (
        <a className="font-medium underline" href={`#${action.anchor}`}>
          Go to this step
        </a>
      ) : null}
    </div>
  );
}
