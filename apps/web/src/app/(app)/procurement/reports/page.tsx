import type { MeView, ProcurementReportsView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Procurement reports — NFC' };

function ReportTable({
  title,
  rows,
}: {
  title: string;
  rows: ProcurementReportsView['byStatus'];
}) {
  return (
    <Surface padded={false}>
      <SurfaceHeader title={title} />
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
          <tr>
            <th className="px-4 py-2 font-semibold">Group</th>
            <th className="px-4 py-2 font-semibold">Count</th>
            <th className="px-4 py-2 font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-4 py-2">{row.label}</td>
              <td className="px-4 py-2 tabular">{row.count}</td>
              <td className="px-4 py-2 tabular">{formatKobo(BigInt(row.amountKobo))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}

export default async function ProcurementReportsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('procurement.report.view')) redirect('/forbidden');
  const reports = await apiFetch<ProcurementReportsView>('/api/procurement/reports');

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Operational reports"
        description="Live counts by status, subsidiary, vendor and category, plus pending ageing."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportTable title="By status" rows={reports.byStatus} />
        <ReportTable title="By subsidiary" rows={reports.bySubsidiary} />
        <ReportTable title="By vendor" rows={reports.byVendor} />
        <ReportTable title="By category" rows={reports.byCategory} />
        <ReportTable title="Pending ageing" rows={reports.ageing} />
      </div>
    </>
  );
}
