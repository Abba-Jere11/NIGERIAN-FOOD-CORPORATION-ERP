import { redirect } from 'next/navigation';
import type { HrAttendanceView, MeView } from '@nfc/shared';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My attendance — NFC' };

export default async function MeAttendancePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('self.workspace')) redirect('/forbidden');
  const rows = await apiFetch<HrAttendanceView[]>('/api/me/attendance');

  return (
    <>
      <PageHeader eyebrow="My workspace" title="Attendance" description="The last 90 days on your record." />
      <Surface padded={false}>
        <SurfaceHeader title="Records" />
        <ul className="divide-y divide-ink-100 text-[13px]">
          {rows.length === 0 ? <li className="px-4 py-3 text-ink-500">No attendance recorded yet.</li> : null}
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between px-4 py-2">
              <span>{row.workDate}</span>
              <span>
                {row.kind}
                {row.minutesLate > 0 ? ` · ${row.minutesLate} min late` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
