import type { FinanceContextView, IntegrityReportView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { resolveFinanceScope } from '../../scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Integrity — NFC' };

export default async function IntegrityPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const query = await searchParams;
  const context = await apiFetch<FinanceContextView>('/api/finance/context');
  const resolved = resolveFinanceScope(context, query.scope);
  const report = await apiFetch<IntegrityReportView>('/api/finance/reports/integrity', {
    query: {
      entityId: resolved.entityId,
      consolidated: resolved.consolidated ? 'true' : undefined,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Integrity"
        description={`${resolved.label}. ${report.discrepancyCount} discrepancy(ies).`}
      />
      <Surface padded={false}>
        <SurfaceHeader title="Checks" />
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Check</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {report.checks.map((check) => (
              <tr key={check.key} className="border-b border-ink-100">
                <td className="px-4 py-2">{check.label}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={check.status} />
                </td>
                <td className="px-4 py-2 text-ink-700">{check.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </>
  );
}
