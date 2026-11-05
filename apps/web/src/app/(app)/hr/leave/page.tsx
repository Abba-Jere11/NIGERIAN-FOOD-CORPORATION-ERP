import type { HrEmployeeListItemView, HrHolidayView, HrLeaveRequestView, HrLeaveTypeView, MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { LeaveForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave — HR — NFC' };

export default async function LeavePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.leave.approve') && !me.permissions.includes('hr.employee.view')) {
    redirect('/forbidden');
  }
  const [requests, calendar, types, employees, holidays] = await Promise.all([
    me.permissions.includes('hr.leave.approve')
      ? apiFetch<HrLeaveRequestView[]>('/api/hr/leave')
      : Promise.resolve([] as HrLeaveRequestView[]),
    apiFetch<HrLeaveRequestView[]>('/api/hr/leave/calendar'),
    apiFetch<HrLeaveTypeView[]>('/api/hr/leave-types'),
    apiFetch<HrEmployeeListItemView[]>('/api/hr/employees'),
    apiFetch<HrHolidayView[]>('/api/hr/holidays'),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Time"
        title="Leave"
        description="HR approves in a single stage. Cancellation is a reversal with a stored reason."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Requests" />
            {requests.length === 0 ? (
              <EmptyState title="No leave requests" description="Raise a request for any subsidiary." />
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase text-ink-500">
                  <tr>
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Employee</th>
                    <th className="px-4 py-2">Dates</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((row) => (
                    <tr key={row.id} className="border-b border-ink-100">
                      <td className="px-4 py-2 font-mono">{row.referenceNumber}</td>
                      <td className="px-4 py-2">
                        {row.employeeName} · {row.entityCode}
                      </td>
                      <td className="px-4 py-2">
                        {row.startsOn} – {row.endsOn} ({row.days}d)
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Group calendar" description="Approved leave across subsidiaries." />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {calendar.map((row) => (
                <li key={row.id} className="px-4 py-2">
                  {row.startsOn} {row.employeeName} ({row.entityCode}) · {row.typeName}
                </li>
              ))}
            </ul>
          </Surface>
        </div>
        <div className="space-y-4">
          <Surface>
            <SurfaceHeader title="Request leave" />
            <div className="px-4 py-3">
              <LeaveForm
                employees={employees.map((row) => ({
                  value: row.id,
                  label: `${row.referenceNumber} ${row.name}`,
                }))}
                types={types.map((row) => ({ value: row.key, label: row.name }))}
              />
            </div>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title="Public holidays" />
            <ul className="divide-y divide-ink-100 text-[13px]">
              {holidays.map((row) => (
                <li key={row.id} className="px-4 py-2">
                  {row.observedOn} · {row.name}
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      </div>
    </>
  );
}
