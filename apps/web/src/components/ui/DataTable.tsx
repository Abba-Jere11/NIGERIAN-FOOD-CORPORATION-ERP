'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/lib/cx';
import { Button } from './Button';
import { EmptyState } from './States';

/**
 * The dense, readable table the whole system uses (A8): sortable, filterable,
 * paginated and exportable, with no decoration.
 *
 * Client-side sorting, filtering and pagination suit the administrative lists in
 * M1. Where the dataset is unbounded, as in the audit viewer, the page passes
 * `paginate={false}` and drives pagination from the server instead.
 */
export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  /** Displayed cell. Falls back to `value`. */
  render?: (row: T) => ReactNode;
  /** Sort, filter and export use this, so they agree with what is displayed. */
  value?: (row: T) => string | number | null;
  width?: string;
  /** Hidden on narrow screens where space is short. */
  secondary?: boolean;
}

export interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption?: string;
  filterable?: boolean;
  filterPlaceholder?: string;
  paginate?: boolean;
  pageSize?: number;
  exportFileName?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  rowHref?: (row: T) => string;
  toolbar?: ReactNode;
  footer?: ReactNode;
}

function cellText(column: DataTableColumn<unknown>, row: unknown): string {
  const value = column.value?.(row);
  return value === null || value === undefined ? '' : String(value);
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  filterable = true,
  filterPlaceholder = 'Filter these rows',
  paginate = true,
  pageSize = 25,
  exportFileName,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  emptyAction,
  rowHref,
  toolbar,
  footer,
}: DataTableProps<T>) {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return rows;
    return rows.filter((row) =>
      columns.some((column) =>
        cellText(column as DataTableColumn<unknown>, row)
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [rows, columns, filter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (!column?.value) return filtered;

    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const a = column.value?.(left) ?? '';
      const b = column.value?.(right) ?? '';
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      return String(a).localeCompare(String(b), 'en', { numeric: true }) * direction;
    });
  }, [filtered, columns, sortKey, sortDirection]);

  const totalPages = paginate ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const currentPage = Math.min(page, totalPages);
  const visible = paginate
    ? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sorted;

  function toggleSort(key: string): void {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  }

  function exportCsv(): void {
    const escape = (text: string): string => {
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = columns.map((column) => escape(column.header)).join(',');
    const body = sorted.map((row) =>
      columns.map((column) => escape(cellText(column as DataTableColumn<unknown>, row))).join(','),
    );
    const csv = `\uFEFF${[header, ...body].join('\r\n')}`;

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportFileName ?? 'export'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const showToolbar = filterable || Boolean(exportFileName) || Boolean(toolbar);

  return (
    <div>
      {showToolbar ? (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-2.5">
          {filterable ? (
            <input
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
              placeholder={filterPlaceholder}
              aria-label={filterPlaceholder}
              className="h-8 w-full max-w-xs border border-ink-300 bg-surface px-2 text-[13px]"
            />
          ) : null}
          {toolbar}
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular text-[12px] text-ink-500">
              {sorted.length === rows.length
                ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
                : `${sorted.length} of ${rows.length} rows`}
            </span>
            {exportFileName ? (
              <Button size="sm" onClick={exportCsv} disabled={sorted.length === 0}>
                Export CSV
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={filter.trim() === '' ? emptyTitle : 'No rows match that filter'}
          {...(filter.trim() === '' && emptyDescription ? { description: emptyDescription } : {})}
          {...(filter.trim() === '' && emptyAction ? { action: emptyAction } : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr className="border-b border-ink-200 bg-surface-muted text-left">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={cx(
                      'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-600',
                      column.align === 'right' && 'text-right',
                      column.secondary && 'hidden md:table-cell',
                    )}
                  >
                    {column.sortable && column.value ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 uppercase hover:text-ink-900"
                        aria-label={`Sort by ${column.header}`}
                      >
                        {column.header}
                        <span aria-hidden="true" className="text-[9px]">
                          {sortKey === column.key
                            ? sortDirection === 'asc'
                              ? '\u25B2'
                              : '\u25BC'
                            : '\u21C5'}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-ink-100 last:border-0 hover:bg-surface-muted"
                >
                  {columns.map((column, columnIndex) => {
                    const content = column.render
                      ? column.render(row)
                      : cellText(column as DataTableColumn<unknown>, row);
                    const href = rowHref?.(row);
                    return (
                      <td
                        key={column.key}
                        className={cx(
                          'px-3 py-2 align-top',
                          column.align === 'right' && 'tabular text-right',
                          column.secondary && 'hidden md:table-cell',
                        )}
                      >
                        {href && columnIndex === 0 ? (
                          <Link
                            href={href}
                            className="font-medium text-accent-700 underline decoration-accent-100 hover:decoration-accent-700"
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginate && totalPages > 1 ? (
        <div className="no-print flex items-center justify-between border-t border-ink-200 px-4 py-2.5">
          <span className="tabular text-[12px] text-ink-500">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {footer}
    </div>
  );
}
