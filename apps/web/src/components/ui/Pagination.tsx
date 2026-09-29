import Link from 'next/link';
import { cx } from '@/lib/cx';

/**
 * Server-driven pagination for unbounded lists such as the audit log, where the
 * rows are fetched a page at a time rather than filtered in the browser.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  buildHref,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  buildHref: (page: number) => string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const linkClass = 'border border-ink-300 bg-surface px-2.5 py-1 text-[13px] hover:bg-ink-100';
  const disabledClass =
    'border border-ink-200 bg-surface-muted px-2.5 py-1 text-[13px] text-ink-400';

  return (
    <nav
      aria-label="Pagination"
      className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-4 py-2.5"
    >
      <p className="tabular text-[12px] text-ink-500">
        {total === 0
          ? 'No entries'
          : `Showing ${first} to ${last} of ${total} ${total === 1 ? 'entry' : 'entries'}`}
      </p>
      <div className="flex items-center gap-2">
        <span className="tabular text-[12px] text-ink-500">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className={linkClass} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cx(disabledClass)} aria-disabled="true">
            Previous
          </span>
        )}
        {page < totalPages ? (
          <Link href={buildHref(page + 1)} className={linkClass} rel="next">
            Next
          </Link>
        ) : (
          <span className={cx(disabledClass)} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
