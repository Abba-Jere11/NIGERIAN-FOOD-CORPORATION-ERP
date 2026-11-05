import type { FinanceContextView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { FinanceForm } from '../../FinanceForm';
import { createExpenseAction } from '../../actions';
import { resolveFinanceScope } from '../../scope';

export const dynamic = 'force-dynamic';

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  return (
    <>
      <PageHeader eyebrow="Finance" title="New expense" description="On-account expenses create a payable." />
      <Surface>
        <FinanceForm
          action={createExpenseAction}
          entityId={resolved.entityId}
          fields={[
            {
              name: 'categoryKey',
              label: 'Category',
              required: true,
              options: [
                { value: 'operating', label: 'Operating' },
                { value: 'utilities', label: 'Utilities' },
                { value: 'maintenance', label: 'Maintenance' },
                { value: 'transport', label: 'Transport' },
                { value: 'admin', label: 'Administration' },
                { value: 'other', label: 'Other' },
              ],
            },
            {
              name: 'settlement',
              label: 'Settlement',
              required: true,
              options: [
                { value: 'ON_ACCOUNT', label: 'On account' },
                { value: 'CASH', label: 'Cash' },
              ],
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
