import type { FinanceContextView, ReceivableAgingView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Receivables — NFC' };

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const aging = await apiFetch<ReceivableAgingView>('/api/finance/receivables/aging', {
    query: { entityId: resolved.entityId },
  });
  return (
    <>
      <PageHeader eyebrow="Finance" title="Receivables" description="Aging from invoice due dates." />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        {(
          [
            ['current', 'Current'],
            ['1_30', '1–30'],
            ['31_60', '31–60'],
            ['61_90', '61–90'],
            ['90_plus', '90+'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="border border-ink-200 bg-surface px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-ink-500">{label}</p>
            <p className="tabular text-[18px] font-semibold">{formatKobo(BigInt(aging.buckets[key]))}</p>
          </div>
        ))}
      </div>
      <Surface padded={false}>
        <SurfaceHeader title="Open invoices" />
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2">Reference</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Due</th>
              <th className="px-4 py-2">Outstanding</th>
              <th className="px-4 py-2">Bucket</th>
            </tr>
          </thead>
          <tbody>
            {aging.invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-ink-100">
                <td className="px-4 py-2">{invoice.referenceNumber}</td>
                <td className="px-4 py-2">{invoice.customerName}</td>
                <td className="px-4 py-2">{invoice.dueDate}</td>
                <td className="tabular px-4 py-2">{formatKobo(BigInt(invoice.outstandingKobo))}</td>
                <td className="px-4 py-2">{invoice.agingBucket}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </>
  );
}
