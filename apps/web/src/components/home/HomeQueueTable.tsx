import Link from 'next/link';
import { formatKobo } from '@nfc/shared';
import { EmptyState } from '@/components/ui/States';

export type HomeQueueRow = {
  id: string;
  reference: string;
  title?: string | null;
  meta?: string | null;
  amountKobo?: number | null;
  href: string;
  actionLabel?: string;
  actionHref?: string;
  detail?: string | null;
};

export function HomeQueueTable({
  rows,
  emptyTitle,
  emptyDescription,
  columns,
}: {
  rows: HomeQueueRow[];
  emptyTitle: string;
  emptyDescription?: string;
  columns?: Array<'reference' | 'meta' | 'amount' | 'detail' | 'action'>;
}) {
  const cols = columns ?? ['reference', 'meta', 'amount'];
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
        <tr>
          {cols.includes('reference') ? <th className="px-4 py-2 font-semibold">Reference</th> : null}
          {cols.includes('meta') ? <th className="px-4 py-2 font-semibold">Detail</th> : null}
          {cols.includes('detail') ? <th className="px-4 py-2 font-semibold">Notes</th> : null}
          {cols.includes('amount') ? <th className="px-4 py-2 font-semibold">Amount</th> : null}
          {cols.includes('action') ? <th className="px-4 py-2 font-semibold">Action</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-ink-100 align-top">
            {cols.includes('reference') ? (
              <td className="px-4 py-2">
                <Link href={row.href} className="underline">
                  {row.reference}
                </Link>
                {row.title ? <span className="block text-ink-600">{row.title}</span> : null}
              </td>
            ) : null}
            {cols.includes('meta') ? <td className="px-4 py-2 text-ink-700">{row.meta ?? '—'}</td> : null}
            {cols.includes('detail') ? (
              <td className="px-4 py-2 text-ink-600">{row.detail ?? '—'}</td>
            ) : null}
            {cols.includes('amount') ? (
              <td className="tabular px-4 py-2">
                {row.amountKobo === null || row.amountKobo === undefined
                  ? '—'
                  : formatKobo(BigInt(row.amountKobo))}
              </td>
            ) : null}
            {cols.includes('action') ? (
              <td className="px-4 py-2">
                {row.actionHref ? (
                  <Link href={row.actionHref} className="font-medium text-accent-800 underline">
                    {row.actionLabel ?? 'Open'}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
