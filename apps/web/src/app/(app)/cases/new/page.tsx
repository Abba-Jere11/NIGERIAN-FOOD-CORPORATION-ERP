import type { MeView } from '@nfc/shared';
import { redirect } from 'next/navigation';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { CaseCreateForm } from '../CaseForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New case — NFC' };

export default async function NewCasePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('cases.create')) redirect('/forbidden');

  return (
    <>
      <PageHeader
        eyebrow="Confidential"
        title="New case"
        description="Only people you assign, grant or CC will see this. Administrators cannot."
      />
      <Surface>
        <SurfaceHeader title="Open" />
        <div className="px-4 py-3">
          <CaseCreateForm entities={me.entities} />
        </div>
      </Surface>
    </>
  );
}
