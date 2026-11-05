import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ConversationView, DirectoryEntryView, MeView } from '@nfc/shared';
import { SelectField, TextField } from '@/components/ui/Field';
import { PageHeader, Surface, SurfaceHeader } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { ActionForm } from '../ActionForm';
import { openDirect, openGroup } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages — NFC' };

export default async function MessagesPage() {
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('message.use')) redirect('/forbidden');
  const [conversations, directory] = await Promise.all([
    apiFetch<ConversationView[]>('/api/me/messages'),
    apiFetch<DirectoryEntryView[]>('/api/directory'),
  ]);
  const people = directory.filter((row) => row.userId && row.userId !== me.ref);

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title="Messages"
        description="Direct messages, groups, and your department channel. This page refreshes when you open a thread."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Surface padded={false}>
          <SurfaceHeader title="Conversations" />
          <ul className="divide-y divide-ink-100 text-[13px]">
            {conversations.length === 0 ? (
              <li className="px-4 py-3 text-ink-500">No conversations yet.</li>
            ) : null}
            {conversations.map((row) => (
              <li key={row.id}>
                <Link href={`/me/messages/${row.id}`} className="flex justify-between px-4 py-2 hover:bg-ink-100">
                  <span>
                    {row.title} · {row.kind}
                  </span>
                  {row.unread > 0 ? <span>{row.unread} new</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Surface>
        <div className="space-y-4">
          <Surface>
            <SurfaceHeader title="New message" />
            <div className="px-4 py-3">
              <ActionForm action={openDirect} submitLabel="Open conversation">
                <SelectField
                  name="userId"
                  label="Colleague"
                  required
                  options={people.map((row) => ({ value: row.userId ?? '', label: row.name }))}
                />
              </ActionForm>
            </div>
          </Surface>
          <Surface>
            <SurfaceHeader title="New group" description="Paste colleague user ids, separated by commas." />
            <div className="px-4 py-3">
              <ActionForm action={openGroup} submitLabel="Create group">
                <TextField name="title" label="Group name" required />
                <SelectField
                  name="memberIds"
                  label="First member"
                  required
                  options={people.map((row) => ({ value: row.userId ?? '', label: row.name }))}
                />
              </ActionForm>
            </div>
          </Surface>
        </div>
      </div>
    </>
  );
}
