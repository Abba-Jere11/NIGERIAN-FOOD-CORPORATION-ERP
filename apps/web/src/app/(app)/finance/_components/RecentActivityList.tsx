import Link from 'next/link';
import { formatKobo } from '@nfc/shared';

export type RecentActivityItem = {
  ref: string;
  date: string;
  description: string;
  entityCode: string | null;
  amountKobo: number;
  href: string;
};

export function RecentActivityList({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return <p className="px-4 py-3 text-[13px] text-ink-500">No recent activity in this scope.</p>;
  }

  return (
    <ul className="divide-y divide-ink-100">
      {items.map((item) => (
        <li key={`${item.href}-${item.ref}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[13px]">
          <div className="min-w-0">
            <Link href={item.href} className="font-medium underline">
              {item.ref}
            </Link>
            <p className="text-ink-600">
              {item.date}
              {item.entityCode ? ` · ${item.entityCode}` : ''} · {item.description}
            </p>
          </div>
          <p className="tabular font-medium text-ink-900">{formatKobo(BigInt(item.amountKobo))}</p>
        </li>
      ))}
    </ul>
  );
}
