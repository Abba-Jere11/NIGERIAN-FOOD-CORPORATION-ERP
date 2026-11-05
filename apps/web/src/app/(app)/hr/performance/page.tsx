import type { HrAppraisalView, HrCycleView, HrEmployeeListItemView, MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { AppraisalForm, CycleForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performance — HR — NFC' };

export default async function PerformancePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.performance.manage')) redirect('/forbidden');
  const [cycles, appraisals, employees] = await Promise.all([
    apiFetch<HrCycleView[]>('/api/hr/cycles'),
    apiFetch<HrAppraisalView[]>('/api/hr/appraisals'),
    apiFetch<HrEmployeeListItemView[]>('/api/hr/employees'),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="Performance"
        description="Review cycles, objectives and appraisals through hr-performance-v1."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Appraisals" />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {appraisals.map((row) => (
                <li key={row.id} className="px-4 py-2">
                  {row.employeeName} · {row.cycleName} · {row.rating ?? 'unrated'}{' '}
                  <StatusBadge status={row.status} />
                </li>
              ))}
            </ul>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Cycles" />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {cycles.map((row) => (
                <li key={row.id} className="px-4 py-2">
                  {row.name} · {row.startsOn} – {row.endsOn}
                </li>
              ))}
            </ul>
          </Surface>
        </div>
        <div className="space-y-4">
          <Surface>
            <SurfaceHeader title="New cycle" />
            <div className="px-4 py-3">
              <CycleForm />
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title="Appraisal" />
            <div className="px-4 py-3">
              <AppraisalForm
                cycles={cycles.map((row) => ({ value: row.id, label: row.name }))}
                employees={employees.map((row) => ({
                  value: row.id,
                  label: `${row.referenceNumber} ${row.name}`,
                }))}
              />
            </div>
          </Surface>
        </div>
      </div>
    </>
  );
}
