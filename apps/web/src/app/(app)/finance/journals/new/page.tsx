import type { AccountView, FinanceContextView, FiscalYearView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope } from '../../scope';
import { JournalForm } from '../JournalForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New journal — NFC' };

export default async function NewJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  if (!resolved.entityId) redirect('/finance/journals');
  const [years, accounts] = await Promise.all([
    apiFetch<FiscalYearView[]>('/api/finance/years', { query: { entityId: resolved.entityId } }),
    apiFetch<AccountView[]>('/api/finance/accounts', { query: { entityId: resolved.entityId } }),
  ]);
  const periods = years.flatMap((year) => year.periods);

  return (
    <>
      <PageHeader eyebrow="Finance" title="New journal" description={`Balanced entry for ${resolved.label}.`} />
      <Surface>
        <JournalForm entityId={resolved.entityId} periods={periods} accounts={accounts} />
      </Surface>
    </>
  );
}
