import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { MeView } from '@nfc/shared';
import { ORGANIZATION_NAME } from '@nfc/shared';
import { NoticeToast } from '@/components/forms/NoticeToast';
import { AppShell } from '@/components/shell/AppShell';
import { apiFetch, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  let me: MeView;
  try {
    me = await apiFetch<MeView>('/api/me');
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) redirect('/login');
    if (error instanceof ApiError && /password/.test(error.message)) {
      redirect('/login/change-password');
    }
    if (error instanceof ApiError && /authenticator|enrol/.test(error.message)) {
      redirect('/login/mfa-enrol');
    }
    return <SetupRequired problem={error instanceof Error ? error.message : String(error)} />;
  }

  if (me.mustChangePassword) redirect('/login/change-password');
  if (me.mfaRequired) redirect('/login/mfa-enrol');

  const unread = await apiFetch<{ count: number }>('/api/notifications/unread-count').catch(
    () => ({ count: 0 }),
  );
  const workspace = me.permissions.includes('self.workspace')
    ? await apiFetch<{ linked: boolean; unreadMessages: number; unreadNotices: number }>(
        '/api/me/summary',
      ).catch(() => ({ linked: false, unreadMessages: 0, unreadNotices: 0 }))
    : null;

  return (
    <AppShell me={me} unreadCount={unread.count} workspace={workspace}>
      {children}
      <NoticeToast />
    </AppShell>
  );
}

function SetupRequired({ problem }: { problem: string }) {
  const steps = [
    'Copy .env.example to .env and set the database and session secrets.',
    'pnpm db:bootstrap — creates the nfc_app role and both databases.',
    'pnpm db:migrate — applies the SQL migrations.',
    'pnpm db:seed — seeds NFC, the four subsidiaries and twelve users.',
    'pnpm dev — starts the API on port 4000 and this application on port 3000.',
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {ORGANIZATION_NAME}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink-900">This system is not ready yet</h1>
      <div className="mt-4 border-l-2 border-danger-600 bg-danger-100 px-3 py-2">
        <p className="text-[13px] text-ink-900">{problem}</p>
      </div>
      <h2 className="mt-6 text-[13px] font-semibold text-ink-900">To get it running</h2>
      <ol className="mt-2 space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2 text-[13px] text-ink-700">
            <span className="tabular shrink-0 text-ink-400">{index + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
