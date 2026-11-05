import type { DepartmentView, EntityView, HrEmployeeListItemView, HrPositionView, HrUnitView, MeView } from '@nfc/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { PositionForm, UnitForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Employees — HR — NFC' };

export default async function EmployeesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.employee.view')) redirect('/forbidden');
  const [rows, units, positions, entities] = await Promise.all([
    apiFetch<HrEmployeeListItemView[]>('/api/hr/employees'),
    apiFetch<HrUnitView[]>('/api/hr/units').catch(() => [] as HrUnitView[]),
    apiFetch<HrPositionView[]>('/api/hr/positions').catch(() => [] as HrPositionView[]),
    apiFetch<EntityView[]>('/api/entities').catch(() => [] as EntityView[]),
  ]);
  const departments = (
    await Promise.all(
      entities.map((entity) =>
        apiFetch<DepartmentView[]>(`/api/entities/${entity.id}/departments`).catch(() => [] as DepartmentView[]),
      ),
    )
  ).flat();
  const entityOpts = entities.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }));
  const deptOpts = departments.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.name}` }));

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Employees"
        description="Records, not login accounts. Sensitive bank and pay fields need hr.view_sensitive."
        actions={
          me.permissions.includes('hr.employee.manage') ? (
            <ButtonLink href="/hr/employees/new" variant="primary">
              New employee
            </ButtonLink>
          ) : null
        }
      />
      <Surface padded={false}>
        <SurfaceHeader title="Directory" />
        {rows.length === 0 ? (
          <EmptyState title="No employees yet" description="Create a record or complete onboarding from a vacancy." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Number</th>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Subsidiary</th>
                <th className="px-4 py-2 font-semibold">Position</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-2 font-mono">
                    <Link href={`/hr/employees/${row.id}`} className="text-accent-800 underline">
                      {row.referenceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.name}</td>
                  <td className="px-4 py-2">{row.entityCode}</td>
                  <td className="px-4 py-2">{row.positionTitle ?? '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      {me.permissions.includes('hr.org.manage') ? (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Surface>
            <SurfaceHeader title={`Units (${units.length})`} />
            <div className="px-4 py-3">
              <UnitForm entities={entityOpts} departments={deptOpts} />
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title={`Positions (${positions.length})`} />
            <div className="px-4 py-3">
              <PositionForm entities={entityOpts} departments={deptOpts} />
            </div>
          </Surface>
        </div>
      ) : null}
    </>
  );
}
