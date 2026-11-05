import type { FinanceContextView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { FinanceForm } from '../../FinanceForm';
import { createCustomerAction } from '../../actions';
import { resolveFinanceScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New customer — NFC' };

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  return (
    <>
      <PageHeader eyebrow="Finance" title="New customer" description="Terms and credit limit are entity-scoped." />
      <Surface>
        <FinanceForm
          action={createCustomerAction}
          entityId={resolved.entityId}
          fields={[
            { name: 'name', label: 'Legal name', required: true },
            { name: 'termsDays', label: 'Terms (days)', defaultValue: '30' },
            { name: 'creditLimit', label: 'Credit limit (₦)' },
          ]}
        />
      </Surface>
    </>
  );
}
