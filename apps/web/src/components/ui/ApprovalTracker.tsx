import { cx } from '@/lib/cx';

/**
 * The approval tracker (M1 item 6).
 *
 * Renders the three states the plan specifies: done, current and pending. It
 * also carries returned and rejected, because M7 needs a tracker that can show
 * a chain that went backwards, and the component should not have to change then.
 *
 * "Who has it now" must be obvious at a glance (A8), so the current stage is the
 * only one rendered in full weight.
 */
export type TrackerStageState = 'done' | 'current' | 'pending' | 'returned' | 'rejected';

export interface TrackerStage {
  key: string;
  label: string;
  state: TrackerStageState;
  /** Who holds or held this stage. */
  actor?: string | null;
  at?: string | null;
}

const MARKS: Record<TrackerStageState, { glyph: string; className: string; srLabel: string }> = {
  done: { glyph: '\u2713', className: 'text-accent-700 border-accent-700', srLabel: 'completed' },
  current: {
    glyph: '\u25CF',
    className: 'text-ink-900 border-ink-900 bg-ink-100',
    srLabel: 'current stage',
  },
  pending: { glyph: '\u25CB', className: 'text-ink-400 border-ink-300', srLabel: 'not started' },
  returned: {
    glyph: '\u21A9',
    className: 'text-warning-700 border-warning-600',
    srLabel: 'returned for correction',
  },
  rejected: {
    glyph: '\u00D7',
    className: 'text-danger-700 border-danger-600',
    srLabel: 'rejected',
  },
};

export function ApprovalTracker({ stages }: { stages: TrackerStage[] }) {
  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:flex-wrap sm:items-start sm:gap-0">
      {stages.map((stage, index) => {
        const mark = MARKS[stage.state];
        const isLast = index === stages.length - 1;
        return (
          <li key={stage.key} className="flex items-start gap-2 sm:flex-col sm:items-start">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] leading-none',
                  mark.className,
                )}
              >
                {mark.glyph}
              </span>
              {!isLast ? (
                <span aria-hidden="true" className="hidden h-px w-12 bg-ink-200 sm:block" />
              ) : null}
            </div>
            <div className={cx('pb-3 sm:pb-0 sm:pr-6', !isLast && 'sm:pr-6')}>
              <p
                className={cx(
                  'text-[13px] leading-tight',
                  stage.state === 'current' ? 'font-semibold text-ink-900' : 'text-ink-700',
                )}
              >
                {stage.label}
                <span className="sr-only"> — {mark.srLabel}</span>
              </p>
              {stage.actor ? <p className="text-[11px] text-ink-500">{stage.actor}</p> : null}
              {stage.at ? <p className="tabular text-[11px] text-ink-400">{stage.at}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
