import type { MeView, PayrollHrReportView } from '@nfc/shared';
import { formatKobo } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR reports — NFC' };

export default async function HrReportsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.employee.view')) redirect('/forbidden');
  const hr = await apiFetch<PayrollHrReportView>('/api/payroll/reports/hr');
  const variance = me.permissions.includes('payroll.view')
    ? await apiFetch<{
        runReference: string | null;
        priorReference: string | null;
        netKobo: number;
        priorNetKobo: number | null;
        varianceKobo: number | null;
      }>('/api/payroll/reports/variance').catch(() => null)
    : null;

  return (
    <>
      <PageHeader
        eyebrow="HR"
        title="Operational reports"
        description="Headcount and leave summaries. Official correspondence still lives under Official reports."
      />
      <Surface className="mb-4">
        <SurfaceHeader title="Headcount" description={`As at ${hr.snapshotAt.slice(0, 10)}`} />
        <ul className="divide-y divide-ink-100 px-4 py-2 text-[13px]">
          {hr.headcountByEntity.map((row) => (
            <li key={row.entityCode} className="flex justify-between py-1">
              <span>{row.entityCode}</span>
              <span className="tabular">{row.count}</span>
            </li>
          ))}
        </ul>
        <p className="px-4 pb-3 text-[13px] text-ink-600">
          Open vacancies: {hr.openVacancies}. Leave days (approved): {hr.leaveDaysInPeriod}.
        </p>
      </Surface>
      {variance ? (
        <Surface className="mb-4">
          <SurfaceHeader title="Payroll variance" description="Requires payroll.view. Aggregate only." />
          <div className="px-4 py-3 text-[13px]">
            <p>Current run: {variance.runReference ?? '—'}</p>
            <p>Net: {formatKobo(BigInt(variance.netKobo))}</p>
            <p>
              Versus {variance.priorReference ?? 'prior'}:{' '}
              {variance.varianceKobo == null ? '—' : formatKobo(BigInt(variance.varianceKobo))}
            </p>
            <p className="mt-2">
              <Link href="/finance/reports/payroll_summary" className="text-accent-800 underline">
                Finance payroll summary
              </Link>
            </p>
          </div>
        </Surface>
      ) : (
        <p className="text-[13px] text-ink-600">Payroll figures on this page require payroll.view.</p>
      )}
      <Surface>
        <SurfaceHeader title="Official reports" description="Specialist HR and payroll templates submit to the Managing Director." />
        <p className="px-4 py-3 text-[13px]">
          <Link href="/org-reports/new" className="text-accent-800 underline">
            Create an official HR or payroll report
          </Link>
        </p>
      </Surface>
    </>
  );
}
