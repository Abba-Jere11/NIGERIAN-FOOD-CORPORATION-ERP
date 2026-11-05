import type { DepartmentView, EntityView, HrPositionView, HrUnitView, MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { EmployeeCreateForm } from '../../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New employee — HR — NFC' };

export default async function NewEmployeePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.employee.manage')) redirect('/forbidden');
  const [entities, units, positions] = await Promise.all([
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
      <PageHeader
        eyebrow="People"
        title="New employee"
        description="Creates EMP- and an EDMS HR user folder. Bank and pay fields are stored for field-level tests only."
      />
      <Surface>
        <SurfaceHeader title="Record" />
        <div className="px-4 py-3">
          <EmployeeCreateForm
            entities={entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))}
            departments={departments.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.name}` }))}
            units={units.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.name}` }))}
            positions={positions.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.title}` }))}
          />
        </div>
      </Surface>
    </>
  );
}
