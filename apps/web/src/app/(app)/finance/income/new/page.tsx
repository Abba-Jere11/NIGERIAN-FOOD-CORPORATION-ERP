import type { CustomerView, FinanceContextView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { FinanceForm } from '../../FinanceForm';
import { createIncomeAction } from '../../actions';
import { resolveFinanceScope } from '../../scope';

export const dynamic = 'force-dynamic';

export default async function NewIncomePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const customers = resolved.entityId
    ? await apiFetch<CustomerView[]>('/api/finance/customers', { query: { entityId: resolved.entityId } })
    : [];
  return (
    <>
      <PageHeader eyebrow="Finance" title="New income" description="Submit for maker-checker before posting." />
      <Surface>
        <FinanceForm
          action={createIncomeAction}
          entityId={resolved.entityId}
          fields={[
            {
              name: 'categoryKey',
              label: 'Category',
              required: true,
              options: [
                { value: 'sales', label: 'Sales' },
                { value: 'service', label: 'Service' },
                { value: 'other', label: 'Other' },
              ],
            },
            {
              name: 'settlement',
              label: 'Settlement',
              required: true,
              options: [
                { value: 'INVOICE', label: 'Invoice (receivable)' },
                { value: 'CASH', label: 'Cash' },
              ],
            },
            {
              name: 'customerId',
              label: 'Customer',
              options: [{ value: '', label: '—' }, ...customers.map((row) => ({ value: row.id, label: row.name }))],
            },
            { name: 'amount', label: 'Amount (₦)', required: true },
            { name: 'occurredOn', label: 'Date', type: 'date', required: true },
            { name: 'dueDate', label: 'Due date', type: 'date' },
            { name: 'narration', label: 'Narration', required: true },
          ]}
        />
      </Surface>
    </>
  );
}
