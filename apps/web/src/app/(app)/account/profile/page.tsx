import type { MeView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const me = await apiFetch<MeView>('/api/me');
  return (
    <>
      <PageHeader eyebrow="Account" title="Profile" />
      <Surface>
        <p className="text-[14px] font-medium text-ink-900">{me.name}</p>
        <p className="mt-1 font-mono text-[13px] text-ink-700">{me.email}</p>
        <p className="mt-1 text-[13px] text-ink-600">{me.position}</p>
      </Surface>
    </>
  );
}
