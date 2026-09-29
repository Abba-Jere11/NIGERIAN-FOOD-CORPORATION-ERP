import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatLagosDateTime } from '@nfc/shared';

/**
 * The generic timeline (M1 item 6), the shape the procurement timeline in M9
 * will use: date, time, actor, what happened, and a link to the record.
 */
export interface TimelineEntry {
  id: string;
  occurredAt: string;
  actor: string;
  text: string;
  href?: string | null;
  detail?: ReactNode;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-ink-500">Nothing has happened yet.</p>;
  }

  return (
    <ol className="relative border-l border-ink-200 pl-5">
      {entries.map((entry) => (
        <li key={entry.id} className="avoid-break relative pb-4 last:pb-0">
          <span
            aria-hidden="true"
            className="absolute -left-[23px] top-1.5 h-1.5 w-1.5 rounded-full bg-ink-400"
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <time className="tabular text-[12px] text-ink-500">
              {formatLagosDateTime(entry.occurredAt)}
            </time>
            <span className="text-[13px] text-ink-900">
              {entry.href ? (
                <Link href={entry.href} className="underline decoration-ink-300 hover:decoration-ink-700">
                  {entry.text}
                </Link>
              ) : (
                entry.text
              )}
            </span>
          </div>
          <p className="text-[12px] text-ink-500">{entry.actor}</p>
          {entry.detail ? <div className="mt-1 text-[12px] text-ink-700">{entry.detail}</div> : null}
        </li>
      ))}
    </ol>
  );
}
