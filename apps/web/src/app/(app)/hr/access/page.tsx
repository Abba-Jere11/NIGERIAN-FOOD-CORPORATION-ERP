import { redirect } from 'next/navigation';
import type { MeView, StaffInviteView } from '@nfc/shared';
import { TextAreaField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../../me/ActionForm';
import { decideInvite } from '../portal-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access approvals — HR — NFC' };

export default async function AccessApprovalsPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('hr.invite.manage')) redirect('/forbidden');
  const invites = await apiFetch<StaffInviteView[]>('/api/hr/invites');

  return (
    <>
      <PageHeader
        eyebrow="HR"
        title="Access approvals"
        description="People who registered from an invite stay pending until you approve them."
      />
      <Surface padded={false}>
        <SurfaceHeader title="Waiting" />
        <ul className="divide-y divide-ink-100">
          {invites.length === 0 ? <li className="px-4 py-3 text-[13px] text-ink-500">No pending registrations.</li> : null}
          {invites.map((invite) => (
            <li key={invite.id} className="space-y-2 px-4 py-3 text-[13px]">
              <p>
                {invite.email} · <StatusBadge status={invite.status} /> · expires{' '}
                {new Date(invite.expiresAt).toLocaleString()}
              </p>
              {invite.status === 'REGISTERED' ? (
                <ActionForm action={decideInvite} submitLabel="Decide">
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <TextAreaField name="reason" label="Reason" required />
                  <label className="mr-3 text-[13px]">
                    <input type="radio" name="decision" value="approve" defaultChecked /> Approve
                  </label>
                  <label className="text-[13px]">
                    <input type="radio" name="decision" value="reject" /> Reject
                  </label>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      </Surface>
    </>
  );
}
