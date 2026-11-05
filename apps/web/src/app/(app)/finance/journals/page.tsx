import type { FinanceContextView, JournalView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Journals — NFC' };

export default async function JournalsPage({
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
  const journals = await apiFetch<JournalView[]>('/api/finance/journals', {
    query: { entityId: resolved.entityId },
  });
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Journals"
        description="Maker-checker. A posted journal is reversed, not edited."
        actions={
          me.permissions.includes('finance.journal.prepare') && resolved.entityId ? (
            <ButtonLink href={withScope('/finance/journals/new', scope)} variant="primary">
              New journal
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {journals.length === 0 ? (
          <EmptyState title="No journals" description="Draft a balanced manual journal to start." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Narration</th>
                <th className="px-4 py-2 font-semibold">Period</th>
                <th className="px-4 py-2 font-semibold">Amount</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((journal) => (
                <tr key={journal.id} className="border-b border-ink-100">
                  <td className="px-4 py-2">
                    <Link href={withScope(`/finance/journals/${journal.id}`, scope)} className="underline">
                      {journal.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{journal.narration}</td>
                  <td className="px-4 py-2">{journal.periodName}</td>
                  <td className="tabular px-4 py-2">{formatKobo(BigInt(journal.debitTotalKobo))}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={journal.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </>
  );
}
