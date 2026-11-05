import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My workspace — NFC' };

export default async function MeHomePage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('self.workspace')) redirect('/forbidden');
  const summary = await apiFetch<{ linked: boolean; unreadMessages: number; unreadNotices: number }>(
    '/api/me/summary',
  );

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title={me.name}
        description={
          summary.linked
            ? 'Your leave, payslips, notices and messages.'
            : 'HR has not linked this account to an employee record yet.'
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Surface>
          <p className="text-[13px] text-ink-500">Unread notices</p>
          <p className="text-xl font-semibold">{summary.unreadNotices}</p>
          <Link href="/me/notices" className="text-[13px] underline">
            Open the board
          </Link>
        </Surface>
        <Surface>
          <p className="text-[13px] text-ink-500">Unread messages</p>
          <p className="text-xl font-semibold">{summary.unreadMessages}</p>
          <Link href="/me/messages" className="text-[13px] underline">
            Open messages
          </Link>
        </Surface>
      </div>
    </>
  );
}
