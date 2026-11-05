import type { BudgetView, FinanceContextView, MeView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { BudgetProgressStrip } from '../_components/BudgetProgressStrip';
import { resolveFinanceScope, withScope } from '../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Budgets — NFC' };

export default async function BudgetsPage({
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
  const budgets = await apiFetch<BudgetView[]>('/api/finance/budgets', {
    query: { entityId: resolved.entityId },
  });
  const scope = resolved.consolidated ? 'consolidated' : resolved.entityCode;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Budgets"
        description="Approved amounts become the live lines procurement already reads. Paid figures are a preview until M11."
        actions={
          me.permissions.includes('finance.budget.prepare') && resolved.entityId ? (
            <ButtonLink href={withScope('/finance/budgets/new', scope)} variant="primary">
              New version
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title={resolved.label} />
        {budgets.length === 0 ? (
          <EmptyState title="No budgets" description="Prepare a version for this fiscal year." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Reference</th>
                <th className="px-4 py-2 font-semibold">Year</th>
                <th className="px-4 py-2 font-semibold">Version</th>
                <th className="px-4 py-2 font-semibold">Approved</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((budget) => (
                <tr key={budget.id} className="border-b border-ink-100 align-top">
                  <td className="px-4 py-2">
                    <Link href={withScope(`/finance/budgets/${budget.id}`, scope)} className="underline">
                      {budget.referenceNumber}
                    </Link>
                    <div className="mt-2 max-w-md">
                      <BudgetProgressStrip lines={budget.lines} compact scope={scope} budgetId={budget.id} />
                    </div>
                  </td>
                  <td className="px-4 py-2">{budget.year}</td>
                  <td className="px-4 py-2">{budget.versionNumber}</td>
                  <td className="tabular px-4 py-2">
                    {formatKobo(BigInt(budget.lines.reduce((sum, line) => sum + line.approvedKobo, 0)))}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={budget.status} />
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
