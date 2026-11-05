import type {
  DepartmentView,
  EntityView,
  HrPositionView,
  HrUnitView,
  HrVacancyView,
  MeView,
} from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { VacancyForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recruitment — HR — NFC' };

export default async function RecruitmentPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.recruitment.manage')) redirect('/forbidden');
  const [rows, entities, units, positions] = await Promise.all([
    apiFetch<HrVacancyView[]>('/api/hr/vacancies'),
    apiFetch<EntityView[]>('/api/entities'),
    apiFetch<HrUnitView[]>('/api/hr/units'),
    apiFetch<HrPositionView[]>('/api/hr/positions'),
  ]);
  const departments = (
    await Promise.all(
      entities.map((entity) =>
        apiFetch<DepartmentView[]>(`/api/entities/${entity.id}/departments`).catch(() => [] as DepartmentView[]),
      ),
    )
  ).flat();

  return (
    <>
      <PageHeader eyebrow="People" title="Recruitment" description="Vacancy to offer. Onboarding creates EMP-." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Vacancies" />
            {rows.length === 0 ? (
              <EmptyState title="No vacancies" description="Submit a vacancy for HR approval." />
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase text-ink-500">
                  <tr>
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-ink-100">
                      <td className="px-4 py-2 font-mono">
                        <Link href={`/hr/recruitment/${row.id}`} className="underline">
                          {row.referenceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{row.title}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Surface>
        </div>
        <Surface>
          <SurfaceHeader title="New vacancy" />
          <div className="px-4 py-3">
            <VacancyForm
              entities={entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
              departments={departments.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.name}` }))}
              units={units.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.name}` }))}
              positions={positions.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.title}` }))}
            />
          </div>
        </Surface>
      </div>
    </>
  );
}
