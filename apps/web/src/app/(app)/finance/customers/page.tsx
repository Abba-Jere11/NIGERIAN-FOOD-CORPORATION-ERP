import type { CustomerView, FinanceContextView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customers — NFC' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const [me, context] = await Promise.all([
    apiFetch<MeView>('/api/me'),
    apiFetch<FinanceContextView>('/api/finance/context'),
  ]);
  const resolved = resolveFinanceScope(context, query.scope);
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;
  const customers = await apiFetch<CustomerView[]>('/api/finance/customers', {
    query: { entityId: resolved.entityId },
  });
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Customers"
        description="Receivable counterparties for the selected entity."
        actions={
          me.permissions.includes('finance.customer.manage') && resolved.entityId ? (
            <ButtonLink href={withScope('/finance/customers/new', scope)} variant="primary">
              New customer
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {customers.length === 0 ? (
          <EmptyState title="No customers" description="Add a customer to raise invoices." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={withScope(`/finance/customers/${customer.id}`, scope)} className="underline">
                      {customer.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{customer.name}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(customer.outstandingKobo))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
