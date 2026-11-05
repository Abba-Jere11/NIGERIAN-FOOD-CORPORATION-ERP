import { redirect } from 'next/navigation';
import type { ConversationView, MeView, MessageView } from '@nfc/shared';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { apiFetch } from '@/lib/api';
import { MessageThread } from './Thread';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Conversation — NFC' };

export default async function MessageThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await apiFetch<MeView>('/api/me');
  if (!me.permissions.includes('message.use')) redirect('/forbidden');
  const [messages, conversations] = await Promise.all([
    apiFetch<MessageView[]>(`/api/me/messages/${id}`),
    apiFetch<ConversationView[]>('/api/me/messages'),
  ]);
  const title = conversations.find((row) => row.id === id)?.title ?? 'Conversation';

  return (
    <>
      <PageHeader eyebrow="Messages" title={title} description="New messages appear within a few seconds." />
      <Surface>
        <MessageThread conversationId={id} messages={messages} />
      </Surface>
    </>
  );
}
