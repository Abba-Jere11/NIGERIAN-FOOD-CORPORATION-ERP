import { redirect } from 'next/navigation';
import type { MeView, NoticeView } from '@nfc/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { markNoticeRead } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices — NFC' };

export default async function NoticesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('notice.view')) redirect('/forbidden');
  const notices = await apiFetch<NoticeView[]>('/api/me/notices');

  return (
    <>
      <PageHeader eyebrow="My workspace" title="Notice board" />
      <div className="space-y-3">
        {notices.length === 0 ? <p className="text-[13px] text-ink-500">No notices right now.</p> : null}
        {notices.map((notice) => (
          <Surface key={notice.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">
                  {notice.pinned ? 'Pinned · ' : ''}
                  {notice.title}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink-700">{notice.body}</p>
              </div>
              {notice.read ? (
                <span className="text-[12px] text-ink-500">Read</span>
              ) : (
                <form action={markNoticeRead.bind(null, notice.id)}>
                  <Button type="submit" size="sm">
                    Mark read
                  </Button>
                </form>
              )}
            </div>
          </Surface>
        ))}
      </div>
    </>
  );
}
