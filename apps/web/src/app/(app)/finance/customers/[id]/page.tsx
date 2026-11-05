import type { CustomerStatementView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function CustomerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const statement = await apiFetch<CustomerStatementView>(`/api/finance/customers/${id}/statement`);
  return (
    <>
      <PageHeader
        eyebrow="Customer statement"
        title={statement.customer.name}
        description={`${statement.customer.referenceNumber} · balance ${formatKobo(BigInt(statement.balanceKobo))}`}
      />
      <Surface padded={false} className="mb-4">
        <SurfaceHeader title="Invoices" />
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2">Reference</th>
              <th className="px-4 py-2">Due</th>
              <th className="px-4 py-2">Outstanding</th>
              <th className="px-4 py-2">Bucket</th>
            </tr>
          </thead>
          <tbody>
            {statement.invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-ink-100">
                <td className="px-4 py-2">{invoice.referenceNumber}</td>
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
