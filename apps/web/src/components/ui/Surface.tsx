import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

/** A plain white panel. No shadow, no rounded hero styling (A8). */
export function Surface({
  children,
  className,
  padded = true,
  id,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cx('print-surface scroll-mt-4 border border-ink-200 bg-surface', padded && 'p-4', className)}
    >
      {children}
    </section>
  );
}

export function SurfaceHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 px-4 py-3">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="no-print flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] text-ink-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="no-print flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Label-and-value pair, used on detail pages and printed records. */
export function DefinitionList({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  columns?: 1 | 2 | 3;
}) {
  const columnClass =
    columns === 1 ? 'sm:grid-cols-1' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-3', columnClass)}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
