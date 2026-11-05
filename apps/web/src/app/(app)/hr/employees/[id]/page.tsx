import type {
  DepartmentView,
  HrChangeView,
  HrEmployeeView,
  HrLeaveBalanceView,
  HrPositionView,
  HrUnitView,
  MeView,
} from '@nfc/shared';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { ChangeForm } from '../../HrForms';
import { EmployeeAccess } from './EmployeeAccess';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Employee — HR — NFC' };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.employee.view')) redirect('/forbidden');
  let employee: HrEmployeeView;
  try {
    employee = await apiFetch<HrEmployeeView>(`/api/hr/employees/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const [changes, balances, units, positions] = await Promise.all([
    apiFetch<HrChangeView[]>(`/api/hr/changes?employeeId=${id}`).catch(() => [] as HrChangeView[]),
    apiFetch<HrLeaveBalanceView[]>(`/api/hr/employees/${id}/leave-balances`).catch(
      () => [] as HrLeaveBalanceView[],
    ),
    apiFetch<HrUnitView[]>('/api/hr/units').catch(() => [] as HrUnitView[]),
    apiFetch<HrPositionView[]>('/api/hr/positions').catch(() => [] as HrPositionView[]),
  ]);
  const departments = (
    await Promise.all(
      me.entities.map((entity) =>
        apiFetch<DepartmentView[]>(`/api/entities/${entity.id}/departments`).catch(() => [] as DepartmentView[]),
      ),
    )
  ).flat();
  const sensitive = me.permissions.includes('hr.view_sensitive');

  return (
    <>
      <PageHeader
        eyebrow={employee.referenceNumber}
        title={employee.name}
        description={`${employee.entityCode} · ${employee.positionTitle ?? 'No position'} · ${employee.employmentType}`}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface>
            <SurfaceHeader title="Profile" />
            <dl className="grid grid-cols-2 gap-2 px-4 py-3 text-[13px]">
              <dt className="text-ink-500">Status</dt>
              <dd>
                <StatusBadge status={employee.status} />
              </dd>
              <dt className="text-ink-500">Department</dt>
              <dd>{employee.departmentName ?? '—'}</dd>
              <dt className="text-ink-500">Unit</dt>
              <dd>{employee.unitName ?? '—'}</dd>
              <dt className="text-ink-500">Work email</dt>
              <dd>{employee.workEmail ?? '—'}</dd>
              <dt className="text-ink-500">Personal email</dt>
              <dd>{sensitive ? (employee.personalEmail ?? '—') : 'Hidden'}</dd>
              <dt className="text-ink-500">Bank</dt>
              <dd>{sensitive ? (employee.bankName ?? '—') : 'Hidden'}</dd>
              <dt className="text-ink-500">Salary</dt>
              <dd>{sensitive ? (employee.salaryKobo ?? '—') : 'Hidden'}</dd>
              <dt className="text-ink-500">EDMS folder</dt>
              <dd>{employee.edmsFolderId ? 'HR user folder created' : '—'}</dd>
            </dl>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Assignment history" description="Transfers append; they never overwrite." />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {employee.assignments.map((row) => (
                <li key={row.id} className="px-4 py-2">
                  {row.kind} · {row.entityCode} · {row.positionTitle ?? '—'} · {row.effectiveOn}
                  {row.endedOn ? ` → ${row.endedOn}` : ' (current)'}
                </li>
              ))}
            </ul>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Leave balances" />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {balances.map((row) => (
                <li key={row.typeKey} className="flex justify-between px-4 py-2">
                  <span>{row.typeName}</span>
                  <span>
                    {row.remaining} remaining of {row.entitled}
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
        <div className="space-y-4">
          {me.permissions.includes('hr.employee.manage') ? (
            <Surface>
              <SurfaceHeader title="Employment change" />
              <div className="px-4 py-3">
                <ChangeForm
                  employeeId={employee.id}
                  departments={departments.map((row) => ({
                    value: row.id,
                    label: `${row.entityCode} ${row.name}`,
                  }))}
                  units={units.map((row) => ({ value: row.id, label: `${row.entityCode} ${row.name}` }))}
                  positions={positions.map((row) => ({
                    value: row.id,
                    label: `${row.entityCode} ${row.title}`,
                  }))}
                />
              </div>
            </Surface>
          ) : null}
          <EmployeeAccess
            employeeId={employee.id}
            departmentId={employee.departmentId}
            canInvite={me.permissions.includes('hr.invite.manage')}
            canSetHead={me.permissions.includes('hr.org.manage')}
          />
          <Surface padded={false}>
            <SurfaceHeader title="Submitted changes" />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {changes.map((row) => (
                <li key={row.id} className="px-4 py-2">
                  {row.kind} · <StatusBadge status={row.status} /> · {row.effectiveOn}
                </li>
              ))}
            </ul>
          </Surface>
          {me.permissions.includes('hr.disciplinary.view') ? (
            <p className="px-1 text-[13px]">
              <Link href="/hr/disciplinary" className="underline">
                Disciplinary cases
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
