import type { HrEmployeeListItemView, HrTrainingView, MeView } from '@nfc/shared';
import { notFound, redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch, ApiError } from '@/lib/api';
import { ParticipantForm, SendFinanceForm } from '../../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training session — HR — NFC' };

export default async function TrainingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.training.view')) redirect('/forbidden');
  let session: HrTrainingView;
  try {
    session = await apiFetch<HrTrainingView>(`/api/hr/training/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const employees = me.permissions.includes('hr.employee.view')
    ? await apiFetch<HrEmployeeListItemView[]>('/api/hr/employees')
    : [];
  const report = me.permissions.includes('hr.training.report');

  return (
    <>
      <PageHeader
        eyebrow={session.referenceNumber}
        title={session.title}
        description={`${session.entityCode} · ${session.category}`}
      />
      <p className="mb-3 text-[13px]">
        <StatusBadge status={session.status} />
        {report && session.estimatedCostKobo != null ? ` · estimated ${session.estimatedCostKobo} kobo` : null}
        {session.expenseEntryId ? ' · linked EXP' : null}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Participants" />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {session.participants.map((row) => (
                <li key={row.employeeId} className="px-4 py-2">
                  {row.employeeName} · {row.attendance}
                  {row.completed ? ' · completed' : ''}
                </li>
              ))}
            </ul>
          </Surface>
        </div>
        <div className="space-y-4">
          {me.permissions.includes('hr.training.manage') ? (
            <Surface>
              <SurfaceHeader title="Attendance" />
              <div className="px-4 py-3">
                <ParticipantForm
                  id={session.id}
                  employees={employees.map((row) => ({
                    value: row.id,
                    label: `${row.referenceNumber} ${row.name}`,
                  }))}
                />
              </div>
            </Surface>
          ) : null}
          {me.permissions.includes('hr.training.approve') && session.estimatedCostKobo != null ? (
            <Surface>
              <SurfaceHeader title="Finance" description="Uses expense-v1. Not a second payment path." />
              <div className="px-4 py-3">
                <SendFinanceForm id={session.id} rowVersion={session.rowVersion} />
              </div>
            </Surface>
          ) : null}
        </div>
      </div>
    </>
  );
}
