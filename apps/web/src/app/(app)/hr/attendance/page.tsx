import type { HrAttendanceView, HrEmployeeListItemView, HrOvertimeView, MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { AttendanceForm, ImportForm, OvertimeForm } from '../HrForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Attendance — HR — NFC' };

export default async function AttendancePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.attendance.manage')) redirect('/forbidden');
  const now = new Date();
  const [rows, overtime, employees, summary] = await Promise.all([
    apiFetch<HrAttendanceView[]>('/api/hr/attendance'),
    apiFetch<HrOvertimeView[]>('/api/hr/overtime'),
    apiFetch<HrEmployeeListItemView[]>('/api/hr/employees'),
    apiFetch<Array<{ employeeName: string; present: number; absent: number; late: number; overtimeHours: number }>>(
      `/api/hr/attendance/summary?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    ),
  ]);
  const options = employees.map((row) => ({ value: row.id, label: `${row.referenceNumber} ${row.name}` }));

  return (
    <>
      <PageHeader
        eyebrow="Time"
        title="Attendance"
        description="Manual entry and CSV import. Device clock-in is deferred. No payslip is computed."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Surface padded={false}>
            <SurfaceHeader title="Register" />
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase text-ink-500">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-4 py-2">Kind</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((row) => (
                  <tr key={row.id} className="border-b border-ink-100">
                    <td className="px-4 py-2">{row.workDate}</td>
                    <td className="px-4 py-2">
                      {row.employeeName} · {row.entityCode}
                    </td>
                    <td className="px-4 py-2">{row.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
          <Surface padded={false}>
            <SurfaceHeader title={`Monthly summary ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`} />
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink-200 bg-surface-muted text-[11px] uppercase text-ink-500">
                <tr>
                  <th className="px-4 py-2">Employee</th>
                  <th className="px-4 py-2">Present</th>
                  <th className="px-4 py-2">Absent</th>
                  <th className="px-4 py-2">Late</th>
                  <th className="px-4 py-2">OT hours</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.employeeName} className="border-b border-ink-100">
                    <td className="px-4 py-2">{row.employeeName}</td>
                    <td className="px-4 py-2">{row.present}</td>
                    <td className="px-4 py-2">{row.absent}</td>
                    <td className="px-4 py-2">{row.late}</td>
                    <td className="px-4 py-2">{row.overtimeHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        </div>
        <div className="space-y-4">
          <Surface>
            <SurfaceHeader title="Record" />
            <div className="px-4 py-3">
              <AttendanceForm employees={options} />
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title="CSV import" />
            <div className="px-4 py-3">
              <ImportForm />
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title="Overtime" />
            <div className="px-4 py-3">
              <OvertimeForm employees={options} />
              <ul className="mt-3 space-y-1 text-[13px]">
                {overtime.map((row) => (
                  <li key={row.id}>
                    {row.employeeName} {row.hours}h <StatusBadge status={row.status} />
                  </li>
                ))}
              </ul>
            </div>
          </Surface>
        </div>
      </div>
    </>
  );
}
