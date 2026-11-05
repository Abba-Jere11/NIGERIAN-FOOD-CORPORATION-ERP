import { redirect } from 'next/navigation';
import type { MeProfileView, MeView } from '@nfc/shared';
import { TextField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../ActionForm';
import { updateProfile } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My profile — NFC' };

export default async function MeProfilePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('self.workspace')) redirect('/forbidden');
  const profile = await apiFetch<MeProfileView>('/api/me/profile');

  return (
    <>
      <PageHeader
        eyebrow={profile.referenceNumber}
        title={profile.name}
        description={`${profile.entityCode} · ${profile.departmentName ?? 'No department'} · ${profile.positionTitle ?? 'No position'}`}
      />
      <Surface>
        <SurfaceHeader
          title="Personal details"
          description="Work assignment and bank details stay with HR."
        />
        <div className="px-4 py-3">
          <ActionForm action={updateProfile} submitLabel="Save profile">
            <input type="hidden" name="rowVersion" value={profile.rowVersion} />
            <TextField name="otherNames" label="Other names" defaultValue={profile.otherNames ?? ''} />
            <TextField name="gender" label="Gender" defaultValue={profile.gender ?? ''} />
            <TextField
              name="personalEmail"
              type="email"
              label="Personal email"
              defaultValue={profile.personalEmail ?? ''}
            />
            <TextField name="personalPhone" label="Personal phone" defaultValue={profile.personalPhone ?? ''} />
            <TextField name="emergencyName" label="Emergency contact" defaultValue={profile.emergencyName ?? ''} />
            <TextField name="emergencyPhone" label="Emergency phone" defaultValue={profile.emergencyPhone ?? ''} />
          </ActionForm>
        </div>
      </Surface>
    </>
  );
}
