import type { BankAccountView, FinanceContextView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { FinanceForm } from '../../FinanceForm';
import { createIntercompanyAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function NewIntercompanyPage() {
  const [context, accounts] = await Promise.all([
    apiFetch<FinanceContextView>('/api/finance/context'),
    apiFetch<BankAccountView[]>('/api/bank-accounts').catch(() => []),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="New inter-company transfer"
        description="Posts mirrored journals on both entities and creates bank movements."
      />
      <Surface>
        <FinanceForm
          action={createIntercompanyAction}
          fields={[
            {
              name: 'type',
              label: 'Type',
              required: true,
              options: [
                { value: 'funding_allocation', label: 'Funding allocation' },
                { value: 'loan', label: 'Loan' },
                { value: 'recharge', label: 'Recharge' },
                { value: 'transfer', label: 'Transfer' },
              ],
            },
            {
              name: 'sourceEntityId',
              label: 'Source entity',
              required: true,
              options: context.entities.map((entity) => ({ value: entity.id, label: `${entity.code} — ${entity.name}` })),
            },
            {
              name: 'destinationEntityId',
              label: 'Destination entity',
              required: true,
              options: context.entities.map((entity) => ({ value: entity.id, label: `${entity.code} — ${entity.name}` })),
            },
            {
              name: 'sourceBankAccountId',
              label: 'Source bank',
              required: true,
              options: accounts.map((row) => ({ value: row.id, label: `${row.entityCode ?? ''} ${row.name}` })),
            },
            {
              name: 'destBankAccountId',
              label: 'Destination bank',
              required: true,
              options: accounts.map((row) => ({ value: row.id, label: `${row.entityCode ?? ''} ${row.name}` })),
            },
            { name: 'amount', label: 'Amount (₦)', required: true },
            { name: 'occurredOn', label: 'Date', type: 'date', required: true },
            { name: 'narration', label: 'Narration', required: true },
          ]}
        />
      </Surface>
    </>
  );
}
