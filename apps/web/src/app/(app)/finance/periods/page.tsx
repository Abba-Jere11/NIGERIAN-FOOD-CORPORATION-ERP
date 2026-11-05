import type { FinanceContextView, FiscalYearView, MeView } from '@nfc/shared';
import { ActionDialog } from '@/components/ui/Dialog';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope } from '../scope';
import { closePeriodAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fiscal periods — NFC' };

export default async function PeriodsPage({
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
  const years = await apiFetch<FiscalYearView[]>('/api/finance/years', {
    query: { entityId: resolved.entityId },
  });
  const canClose = me.permissions.includes('finance.period.close');

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Fiscal periods"
        description="Posting is blocked unless the period is open. Locked is terminal."
      />
      {years.length === 0 ? (
        <EmptyState title="No fiscal years" description="ED Finance opens a year before journals can post." />
      ) : (
        years.map((year) => (
          <Surface key={year.id} className="mb-4" padded={false}>
            <SurfaceHeader title={`${year.entityCode ?? ''} ${year.year}`} description={`${year.startsOn} – ${year.endsOn}`} />
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Period</th>
                  <th className="px-4 py-2 font-semibold">Dates</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  {canClose ? <th className="px-4 py-2 font-semibold"> </th> : null}
                </tr>
              </thead>
              <tbody>
                {year.periods.map((period) => (
                  <tr key={period.id} className="border-b border-ink-100">
                    <td className="px-4 py-2">{period.name}</td>
                    <td className="px-4 py-2">
                      {period.startsOn} – {period.endsOn}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={period.status} />
                    </td>
                    {canClose ? (
                      <td className="px-4 py-2">
                        {period.status === 'OPEN' ? (
                          <ActionDialog
                            triggerLabel="Close"
                            title={`Close ${period.name}`}
                            submitLabel="Close period"
                            successMessage="Period closed."
                            action={closePeriodAction}
                            hiddenFields={{ id: period.id, rowVersion: String(period.rowVersion) }}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        ))
      )}
    </>
  );
}
