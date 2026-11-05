import Link from 'next/link';
import { cx } from '@/lib/cx';

export function HomeKpiCard({
  label,
  value,
  href,
  danger,
  hint,
}: {
  label: string;
  value: string | number;
  href?: string;
  danger?: boolean;
  hint?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wider text-ink-500">{label}</p>
      <p
        className={cx(
          'tabular text-[20px] font-semibold',
          danger ? 'text-danger-700' : 'text-ink-900',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p> : null}
    </>
  );
  const className = cx(
    'border border-ink-200 bg-surface px-3 py-2',
    href ? 'hover:bg-ink-50' : null,
    danger ? 'border-danger-100' : null,
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
