import type { FinanceContextView, FiscalYearView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope } from '../../scope';
import { BudgetForm } from '../BudgetForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New budget — NFC' };

export default async function NewBudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  if (!resolved.entityId) redirect('/finance/budgets');
  const years = await apiFetch<FiscalYearView[]>('/api/finance/years', {
    query: { entityId: resolved.entityId },
  });

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="New budget version"
        description="A pending version does not change the live amounts procurement uses."
      />
      <Surface>
        <BudgetForm entityId={resolved.entityId} years={years} />
      </Surface>
    </>
  );
}
