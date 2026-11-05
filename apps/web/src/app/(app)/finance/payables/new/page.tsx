import type { FinanceContextView, VendorListItemView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { FinanceForm } from '../../FinanceForm';
import { createBillAction } from '../../actions';
import { resolveFinanceScope } from '../../scope';

export const dynamic = 'force-dynamic';

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const vendors = await apiFetch<VendorListItemView[]>('/api/vendors').catch(() => []);
  return (
    <>
      <PageHeader eyebrow="Finance" title="New vendor bill" description="Non-procurement bill. Approval posts to trade payables." />
      <Surface>
        <FinanceForm
          action={createBillAction}
          entityId={resolved.entityId}
          fields={[
            {
              name: 'vendorId',
              label: 'Vendor',
              required: true,
              options: vendors.map((row) => ({ value: row.id, label: row.legalName })),
            },
            { name: 'invoiceDate', label: 'Invoice date', type: 'date', required: true },
            { name: 'dueDate', label: 'Due date', type: 'date', required: true },
            { name: 'amount', label: 'Amount (₦)', required: true },
            { name: 'narration', label: 'Narration', required: true },
          ]}
        />
      </Surface>
    </>
  );
}
