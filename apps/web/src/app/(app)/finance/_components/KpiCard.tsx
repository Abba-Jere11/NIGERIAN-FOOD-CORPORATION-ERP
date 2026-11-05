import Link from 'next/link';
import { formatKobo } from '@nfc/shared';
import { withScope } from '../scope';

export function KpiCard({
  label,
  valueKobo,
  href,
  scope,
  compact,
}: {
  label: string;
  valueKobo: number;
  href: string;
  scope?: string;
  compact?: boolean;
}) {
  return (
    <Link href={withScope(href, scope)} className="border border-ink-200 bg-surface px-3 py-2 hover:bg-ink-50">
      <p className="text-[11px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`tabular font-semibold text-ink-900 ${compact ? 'text-[16px]' : 'text-[20px]'}`}>
        {formatKobo(BigInt(valueKobo))}
      </p>
    </Link>
  );
}
