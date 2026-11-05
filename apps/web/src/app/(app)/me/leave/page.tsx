import { redirect } from 'next/navigation';
import type { DirectoryEntryView, HrLeaveBalanceView, HrLeaveRequestView, MeProfileView, MeView } from '@nfc/shared';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../ActionForm';
import { requestOwnLeave } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My leave — NFC' };

export default async function MeLeavePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('self.leave.request')) redirect('/forbidden');
  const [leave, profile, directory] = await Promise.all([
    apiFetch<{ requests: HrLeaveRequestView[]; balances: HrLeaveBalanceView[] }>('/api/me/leave'),
    apiFetch<MeProfileView>('/api/me/profile'),
    apiFetch<DirectoryEntryView[]>('/api/directory'),
  ]);
  const colleagues = directory.filter(
    (row) => row.departmentName === profile.departmentName && row.employeeId !== profile.employeeId && row.userId,
  );

  return (
    <>
      <PageHeader eyebrow="My workspace" title="Leave" description="A colleague in your department covers you first." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader title="Request leave" />
          <div className="px-4 py-3">
            <ActionForm action={requestOwnLeave} submitLabel="Submit request">
              <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
              <SelectField
                name="typeKey"
                label="Leave type"
                required
                options={leave.balances.map((row) => ({
                  value: row.typeKey,
                  label: `${row.typeName} (${row.remaining} left)`,
                }))}
              />
              <TextField name="startsOn" type="date" label="Starts" required />
              <TextField name="endsOn" type="date" label="Ends" required />
              <SelectField
                name="reliefEmployeeId"
                label="Relief officer"
                required
                options={colleagues.map((row) => ({ value: row.employeeId, label: row.name }))}
              />
              <TextAreaField name="reason" label="Reason" />
            </ActionForm>
          </div>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="History" />
          <ul className="divide-y divide-ink-100 text-[13px]">
            {leave.requests.length === 0 ? (
              <li className="px-4 py-3 text-ink-500">No leave requests yet.</li>
            ) : null}
            {leave.requests.map((row) => (
              <li key={row.id} className="px-4 py-2">
                {row.referenceNumber} · {row.typeName} · {row.startsOn} to {row.endsOn} ·{' '}
                <StatusBadge status={row.status} />
              </li>
            ))}
          </ul>
        </Surface>
      </div>
    </>
  );
}
