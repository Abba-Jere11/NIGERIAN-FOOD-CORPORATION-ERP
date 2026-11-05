import type { HrDashboardView, MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { HomeKpiCard } from '@/components/home/HomeKpiCard';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home — HR — NFC' };

export default async function HrHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.employee.view')) redirect('/forbidden');
  const dash = await apiFetch<HrDashboardView>('/api/hr/dashboard');

  return (
    <>
      <PageHeader
        eyebrow="Corporate"
        title={`Good day, ${me.name.split(' ')[0] ?? me.name}`}
        description="People records across all four subsidiaries. There is no staff self-service."
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <HomeKpiCard label="Headcount" value={dash.headcount} href="/hr/employees" />
        <HomeKpiCard label="Pending leave" value={dash.pendingLeave} href="/hr/leave" />
        <HomeKpiCard label="Open vacancies" value={dash.openVacancies} href="/hr/recruitment" />
        <HomeKpiCard
          label="Open disciplinary"
          value={dash.openDisciplinary}
          href="/hr/disciplinary"
          danger={dash.openDisciplinary > 0}
        />
        <HomeKpiCard label="Upcoming training" value={dash.upcomingTraining} href="/hr/training" />
        <HomeKpiCard
          label="Overdue training"
          value={dash.overdueTraining}
          href="/hr/training"
          danger={dash.overdueTraining > 0}
        />
        {me.permissions.includes('payroll.view') ? (
          <HomeKpiCard
            label="Payroll runs"
            value={dash.pendingPayroll}
            href="/hr/payroll"
            danger={dash.pendingPayroll > 0}
          />
        ) : null}
      </div>
      <Surface padded={false}>
        <SurfaceHeader title="By subsidiary" description="Active and probation staff only." />
        <ul className="divide-y divide-ink-100 text-[13px]">
          {dash.byEntity.map((row) => (
            <li key={row.entityCode} className="flex justify-between px-4 py-2">
              <span>{row.entityCode}</span>
              <span className="tabular">{row.count}</span>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
