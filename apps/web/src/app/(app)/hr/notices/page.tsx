import { redirect } from 'next/navigation';
import type { MeView, NoticeView } from '@nfc/shared';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../../me/ActionForm';
import { publishNotice } from '../portal-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices — HR — NFC' };

export default async function HrNoticesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('notice.manage')) redirect('/forbidden');
  const notices = await apiFetch<NoticeView[]>('/api/hr/notices');

  return (
    <>
      <PageHeader eyebrow="HR" title="Notices" description="Published notices notify people and appear on My workspace." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader title="Publish" description="Audience is everyone until company policy narrows it." />
          <div className="px-4 py-3">
            <ActionForm action={publishNotice} submitLabel="Publish">
              <TextField name="title" label="Title" required />
              <TextAreaField name="body" label="Body" required />
              <TextField name="entityId" label="Subsidiary id" hint="Leave blank for a group-wide notice." />
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="pinned" />
                Pin
              </label>
            </ActionForm>
          </div>
        </Surface>
        <Surface padded={false}>
          <SurfaceHeader title="Published" />
          <ul className="divide-y divide-ink-100 text-[13px]">
            {notices.map((notice) => (
              <li key={notice.id} className="px-4 py-2">
                {notice.title} · {notice.status}
              </li>
            ))}
          </ul>
        </Surface>
      </div>
    </>
  );
}
